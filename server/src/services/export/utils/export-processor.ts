import { Schema, UID } from '@strapi/types';
import { ExportContext } from './export-context';
import { buildPopulateForModel } from '../buildPopulate';
import { getModel, isComponentAttribute, isDynamicZoneAttribute, isMediaAttribute, isRelationAttribute } from '../../../utils/models';
import { validateIdField } from '../validation';
import { getConfig } from '../../../utils/getConfig';
import { getIdentifierField } from '../../../utils/identifiers';
import { logger } from '../../../utils/logger';

interface VersionData {
    draft?: Record<string, any>;
    published?: Record<string, any>;
}

export class ExportProcessor {
    constructor(
        private context: ExportContext,
        private services: {
            documents: typeof strapi.documents;
        }
    ) {}

    async processSchema(currentSlug: string) {
        const context = {
            operation: 'export',
            contentType: currentSlug
        };

        const model = getModel(currentSlug);
        if (!model || model.uid === 'admin::user') {
            logger.debug(`Skipping model`, context);
            return;
        }

        try {
            validateIdField(model);
        } catch (error) {
            logger.error('ID field validation failed', context, error);
            throw error;
        }

        logger.debug('Processing schema', context);
        const populate = buildPopulateForModel(currentSlug);

        if (!this.context.exportedData[currentSlug]) {
            this.context.exportedData[currentSlug] = [];
        }

        // Build filters object correctly
        const documentIdFilter = this.context.options.documentIds?.length ? {
            documentId: { $in: this.context.options.documentIds }
        } : {};

        const searchParams = this.context.options.applySearch && this.context.options.search ? (
            typeof this.context.options.search === 'string' ? 
                JSON.parse(this.context.options.search) : 
                this.context.options.search
        ) : {};

        const filtersAndDocs = {
            filters: {
                ...searchParams.filters,
                ...documentIdFilter
            },
            ...(this.context.options.applySearch && searchParams.sort && { sort: searchParams.sort })
        };

        console.log('FILTERS AND DOCS', JSON.stringify(filtersAndDocs, null, 2));

        // Get all draft entries first
        const draftEntries = await this.services.documents(currentSlug as UID.ContentType).findMany({
            ...filtersAndDocs,
            status: 'draft',
            populate: {
                ...populate,
                ...(this.context.options.exportAllLocales && {
                    localizations: {
                        populate
                    }
                })
            }
        });

        console.log('DRAFT ENTRIES', JSON.stringify(draftEntries, null, 2));

        logger.debug(`Found ${draftEntries.length} draft entries`, context);

        // Process each draft entry and its corresponding published version
        for (const draftEntry of draftEntries) {
            await this.processEntry(currentSlug, draftEntry, model, populate);
        }
    }

    private async processEntry(
        contentType: string,
        draftEntry: any,
        model: Schema.Schema,
        populate: any
    ) {
        const context = {
            operation: 'export',
            contentType,
            documentId: draftEntry.documentId
        };

        try {
            const publishedEntry = await this.services.documents(contentType as UID.ContentType).findOne({
                documentId: draftEntry.documentId,
                status: 'published',
                populate: {
                    ...populate,
                    ...(this.context.options.exportAllLocales && {
                        localizations: {
                            populate
                        }
                    })
                }
            });

            const versions = this.groupByLocale(draftEntry, publishedEntry, model);
            
            // Only add if there are actual differences
            if (versions.draft || versions.published) {
                this.context.exportedData[contentType].push(versions);
                this.context.recordProcessed(draftEntry.documentId);
            }
        } catch (error) {
            logger.error('Failed to process entry', context, error);
            throw error;
        }
    }

    private groupByLocale(entry: any, publishedEntry: any, model: Schema.Schema): VersionData {
        const result: VersionData = {};

        // Always remove localizations from the processed data
        const processEntry = (data) => {
            const processed = this.processDataWithSchema(data, model, { 
                processLocalizations: true
            });
            delete processed.localizations;
            return processed;
        };

        // Compare draft and published versions for each locale
        const draftData = processEntry(entry);
        const publishedData = publishedEntry ? processEntry(publishedEntry) : null;

        // Only include draft if it's different from published
        if (!publishedData || !this.areVersionsEqual(draftData, publishedData)) {
            result.draft = { default: draftData };
        }

        // Process localizations if exporting all locales
        if (this.context.options.exportAllLocales && entry.localizations?.length) {
            for (const draftLoc of entry.localizations) {
                const locale = draftLoc.locale;
                if (!locale) continue;

                // Find corresponding published localization
                const publishedLoc = publishedEntry?.localizations?.find(l => l.locale === locale);
                
                const draftLocData = processEntry(draftLoc);
                const publishedLocData = publishedLoc ? processEntry(publishedLoc) : null;

                // Only include draft if it's different from published
                if (!publishedLocData || !this.areVersionsEqual(draftLocData, publishedLocData)) {
                    if (!result.draft) result.draft = {};
                    result.draft[locale] = draftLocData;
                }
            }
        }

        // Add published versions
        if (publishedEntry) {
            result.published = { default: processEntry(publishedEntry) };

            if (this.context.options.exportAllLocales && publishedEntry.localizations?.length) {
                for (const publishedLoc of publishedEntry.localizations) {
                    const locale = publishedLoc.locale;
                    if (!locale) continue;
                    result.published[locale] = processEntry(publishedLoc);
                }
            }
        }

        return result;
    }

    private processDataWithSchema(
        data: any, 
        schema: Schema.Schema, 
        options = { 
            processLocalizations: true,
        },
        skipRelationsOverride: boolean | null = null
    ): any {
        if (!data) return null;

        const processed = { ...data };
        
        delete processed.id;
        delete processed.documentId;
        delete processed.createdBy;
        delete processed.updatedBy;

        // Only remove localizations if not specifically processing them
        if (!options.processLocalizations) {
            delete processed.localizations;
        }

        for (const [key, attr] of Object.entries(schema.attributes)) {
            if (data[key] === undefined || data[key] === null) continue;

            if (key === 'localizations' && options.processLocalizations) {
                processed[key] = data[key]?.map(localization => 
                    ({...this.processDataWithSchema(localization, schema, { processLocalizations: false }), documentId: localization.documentId})
                ) || [];
                continue;
            }

            try {
                if (isRelationAttribute(attr)) {
                    console.log('PROCESSING RELATION', attr);
                    processed[key] = this.processRelation(data[key], attr.target, attr, skipRelationsOverride);
                } else if (isComponentAttribute(attr)) {
                    if (attr.repeatable) {
                        processed[key] = data[key]?.map(item => 
                            this.processComponent(item, attr.component)
                        ) || [];
                    } else {
                        processed[key] = this.processComponent(data[key], attr.component);
                    }
                } else if (isDynamicZoneAttribute(attr)) {
                    processed[key] = this.processDynamicZone(data[key]);
                } else if (isMediaAttribute(attr)) {
                    processed[key] = this.processMedia(data[key], attr);
                }
            } catch (error) {
                logger.error(`Failed to process attribute`, {
                    operation: 'export',
                    attribute: key,
                    contentType: schema.uid
                }, error);
                processed[key] = null;
            }
        }

        return processed;
    }

    private processRelation(item: any, targetModelUid: string, attr: Schema.Attribute.Relation, skipRelationsOverride: boolean | null = null): any {
        if (!item) return null;
        if (Array.isArray(item) && item.length === 0) return [];

        const targetModel = getModel(targetModelUid);
        if (!targetModel || targetModel.uid === 'admin::user') return null;

        const idField = getIdentifierField(targetModel);

        const skipRelations = skipRelationsOverride ?? this.context.options.skipRelations;

        if (attr.relation.endsWith('Many') || attr.relation === 'manyWay') {
            if (!Array.isArray(item)) {
                logger.warn('Expected array for many relation', { targetModelUid });
                return [];
            }
            return item.map(relItem => {
                if (!skipRelations && 
                    !this.context.wasProcessed(relItem.documentId)) {
                    this.context.addRelation(targetModelUid as UID.ContentType, relItem.documentId);
                }
                return relItem[idField];
            });
        } else {
            if (Array.isArray(item)) {
                logger.warn('Expected single item for one relation', { targetModelUid });
                return null;
            }
            if (!skipRelations && 
                !this.context.wasProcessed(item.documentId)) {
                this.context.addRelation(targetModelUid as UID.ContentType, item.documentId);
            }
            return item[idField];
        }
    }

    private processComponent(item: any, componentUid: string): any {
        if (!item) return null;

        const componentModel = getModel(componentUid);
        if (!componentModel) return null;

        return this.processDataWithSchema(item, componentModel, { 
            processLocalizations: this.context.options.exportAllLocales
        }, this.context.options.skipComponentRelations);
    }

    private processDynamicZone(items: any[]): any[] {
        if (!Array.isArray(items)) return [];

        return items.map(item => {
            const componentModel = getModel(item.__component);
            if (!componentModel) return null;

            return {
                __component: item.__component,
                ...this.processDataWithSchema(item, componentModel, {
                    processLocalizations: this.context.options.exportAllLocales
                }, this.context.options.skipComponentRelations)
            };
        }).filter(Boolean);
    }

    private processMedia(item: any, attr: Schema.Attribute.Media): any {
        if (!item) return null;
        
        const processMediaItem = (mediaItem) => ({
            url: mediaItem.url.startsWith('/') ? this.computeUrl(mediaItem.url) : mediaItem.url,
            name: mediaItem.name,
            caption: mediaItem.caption,
            hash: mediaItem.hash,
            alternativeText: mediaItem.alternativeText,
            createdAt: mediaItem.createdAt,
            updatedAt: mediaItem.updatedAt,
            publishedAt: mediaItem.publishedAt,
        });

        if (attr.multiple) {
            return Array.isArray(item) ? item.map(processMediaItem) : [];
        }
        return processMediaItem(item);
    }

    private computeUrl(relativeUrl: string): string {
        return getConfig('serverPublicHostname') + relativeUrl;
    }

    private areVersionsEqual(version1: any, version2: any, excludeFields = ['publishedAt']): boolean {
        const v1 = { ...version1 };
        const v2 = { ...version2 };
        
        excludeFields.forEach(field => {
            delete v1[field];
            delete v2[field];
        });
        
        return JSON.stringify(v1) === JSON.stringify(v2);
    }

    getExportData(): string {
        return JSON.stringify({
            version: 3,
            data: this.context.exportedData
        }, null, '\t');
    }
} 
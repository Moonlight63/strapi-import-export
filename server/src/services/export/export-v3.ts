import { getAllSlugs } from '../../utils/models';
import { CustomSlugs, CustomSlugToSlug } from '../../config/constants.js';
import { buildFilterQuery } from '../../utils/query';
import { ExportContext } from './utils/export-context';
import { ExportProcessor } from './utils/export-processor';

export interface ExportV3Options {
    slug: string;
    search: string;
    applySearch: boolean;
    exportPluginsContentTypes: boolean;
    documentIds?: string[];
    maxDepth?: number;
    exportAllLocales?: boolean;
    exportRelations?: boolean;
    deepPopulateRelations?: boolean;
    deepPopulateComponentRelations?: boolean;
}

export async function exportDataV3({
    slug,
    search,
    applySearch,
    exportPluginsContentTypes,
    documentIds,
    maxDepth = 20,
    exportAllLocales = true,
    exportRelations = false,
    deepPopulateRelations = false,
    deepPopulateComponentRelations = false
}: ExportV3Options): Promise<string> {
    const slugsToExport = 
        slug === CustomSlugs.WHOLE_DB ? 
        getAllSlugs({ includePluginsContentTypes: exportPluginsContentTypes }) : 
        [CustomSlugToSlug[slug] || slug];

    const searchParams = applySearch ? buildFilterQuery(search) : {};
    
    const context = new ExportContext({
        documentIds,
        applySearch,
        search: searchParams,
        exportAllLocales,
        exportRelations,
        skipRelations: false,
        skipComponentRelations: false
    });

    console.log('Skip relations', deepPopulateRelations === false, deepPopulateComponentRelations === false);

    const processor = new ExportProcessor(context, {
        documents: strapi.documents
    });

    for (const currentSlug of slugsToExport) {
        await processor.processSchema(currentSlug);
    }

    console.log('FIRST RELATIONS:', context.getRelations());

    context.setSkipRelations(deepPopulateRelations === false);
    context.setSkipComponentRelations(deepPopulateComponentRelations === false);

    let loopCount = 0;
    while (Object.keys(context.getRelations()).length > 0 && exportRelations && loopCount < maxDepth) {
        const nextRelations = context.getRelations();
        context.clearRelations();

        for (const [key, documentIds] of Object.entries(nextRelations)) {
            console.log('PROCESSING RELATIONS FOR', key);
            console.log('DOCUMENT IDS', documentIds);
            context.setDocumentIds(documentIds);
            await processor.processSchema(key);
        }

        context.processedRelations[loopCount] = nextRelations;
        loopCount++;
    }

    return JSON.stringify({
        version: 3,
        data: context.exportedData
    }, null, '\t');
} 

// import { getModel, getModelAttributes, isComponentAttribute, isDynamicZoneAttribute, isMediaAttribute, isRelationAttribute, getAllSlugs } from '../../utils/models';
// import { CustomSlugs, CustomSlugToSlug } from '../../config/constants.js';
// import { buildPopulateForModel } from './buildPopulate.js';
// import { getConfig } from '../../utils/getConfig.js';

// import { Struct, Schema, UID } from '@strapi/types';

// type Relation = {
//   [slug in UID.ContentType]: string[]
// }

// /**
//  * 
//  * Get the identifier field for a model, falling back through uid -> name -> title -> id
//  */
// function getIdentifierField(model) {
//   console.log('getIdentifierField for model:', model.uid);
//   if (model.pluginOptions?.['import-export-entries']?.idField) {
//     console.log('Using configured idField:', model.pluginOptions['import-export-entries'].idField);
//     return model.pluginOptions['import-export-entries'].idField;
//   }
  
//   const attributes = model.attributes || {};
//   console.log('Looking for identifier in attributes:', Object.keys(attributes));
//   if (attributes.uid) return 'uid';
//   if (attributes.name) return 'name';
//   if (attributes.title) return 'title';
//   console.log('Falling back to id');
//   return 'id';
// }

// /**
//  * Compute the absolute URL from a relative URL
//  */
// const computeUrl = (relativeUrl) => {
//   return getConfig('serverPublicHostname') + relativeUrl;
// };

// /**
//  * Recursively process any data object according to its schema
//  */
// function processDataWithSchema(data, schema: Schema.Schema, relations: Relation, alreadyProcessed: Relation, options = { processLocalizations: true, skipRelations: false, skipComponentRelations: false }) {
//   console.log(`Processing data for schema: ${schema.uid}`);
//   console.log('Raw data:', JSON.stringify(data, null, 2));
//   if (!data) return null;

//   const processed = { ...data };
  
//   // Only delete id if it's not being used as the identifier field
//   // const idField = getIdentifierField(schema);
//   // console.log('Identifier field:', idField, 'schema:', schema.uid, 'id:', processed.id);
//   // if (idField !== 'id') {
//     delete processed.id;
//   // }

//   delete processed.documentId;

//   delete processed.createdBy; // TODO: we can't import data as a different user, so lets not export it
//   delete processed.updatedBy; // TODO: we can't import data as a different user, so lets not export it

//   if (!options.processLocalizations) {
//     delete processed.localizations;
//   }
  

//   for (const [key, attr] of Object.entries(schema.attributes)) {
//     console.log(`Processing attribute ${key} of type ${attr.type}`);
//     console.log(`Current value:`, JSON.stringify(data[key], null, 2));
    
//     if (data[key] === undefined || data[key] === null) {
//       console.log(`No data for ${key}, skipping`);
//       continue;
//     }

//     // Special handling for localizations
//     if (key === 'localizations' && options.processLocalizations) {
//       console.log('Processing localizations');
//       processed[key] = data[key]?.map(localization => 
//         // Process each localization but prevent recursive localization processing
//         ({...(processDataWithSchema(localization, schema, relations, alreadyProcessed, { processLocalizations: false, skipRelations: options.skipRelations, skipComponentRelations: options.skipComponentRelations })), documentId: localization.documentId})
//       ) || [];
//       continue;
//     }

//     if (isRelationAttribute(attr)) {
//       const relatedModel = getModel((attr as Schema.Attribute.RelationWithTarget).target);
//       const relatedIdField = getIdentifierField(relatedModel);
//       console.log(`Relation ${key} uses identifier field ${relatedIdField}`);
      
//       if (attr.relation.endsWith('Many') || attr.relation === 'manyWay') {
//         processed[key] = data[key]?.map(item => {
//           console.log('Processing relation item:', item);
//           // check if item.documentID is not in alreadyProcessed[relatedModel.uid] or relations[relatedModel.uid]
//           if (!options.skipRelations && !alreadyProcessed[relatedModel.uid]?.includes(item.documentId) && !relations[relatedModel.uid]?.includes(item.documentId)) {
//             // add the document to relations[relatedModel.uid]
//             if (!relations[relatedModel.uid]) {
//               relations[relatedModel.uid] = [];
//             }
//             relations[relatedModel.uid].push(item.documentId);
//           }
//           return item[relatedIdField];
//         }) || [];
//       } else {
//         console.log('Processing single relation:', data[key]);
//         // check if item.documentID is not in alreadyProcessed[relatedModel.uid] or relations[relatedModel.uid]
//         if (!options.skipRelations && !alreadyProcessed[relatedModel.uid]?.includes(data[key].documentId) && !relations[relatedModel.uid]?.includes(data[key].documentId)) {
//           // add the document to relations[relatedModel.uid]
//           if (!relations[relatedModel.uid]) {
//             relations[relatedModel.uid] = [];
//           }
//           relations[relatedModel.uid].push(data[key].documentId);
//         }
//         processed[key] = data[key]?.[relatedIdField] || null;
//       }
//     } else if (isComponentAttribute(attr)) {
//       const componentModel = getModel(attr.component);
//       console.log(`Processing component ${key} with model ${componentModel.uid}`);
      
//       if (attr.repeatable) {
//         processed[key] = data[key]?.map(item => 
//           processDataWithSchema(item, componentModel, relations, alreadyProcessed, { processLocalizations: options.processLocalizations, skipRelations: options.skipComponentRelations, skipComponentRelations: options.skipComponentRelations })
//         ) || [];
//       } else {
//         processed[key] = processDataWithSchema(data[key], componentModel, relations, alreadyProcessed, { processLocalizations: options.processLocalizations, skipRelations: options.skipComponentRelations, skipComponentRelations: options.skipComponentRelations });
//       }
//     } else if (isDynamicZoneAttribute(attr)) {
//       console.log(`Processing dynamic zone ${key}`);
//       processed[key] = data[key]?.map(item => {
//         const componentModel = getModel(item.__component);
//         return {
//           __component: item.__component,
//           ...processDataWithSchema(item, componentModel, relations, alreadyProcessed, { processLocalizations: options.processLocalizations, skipRelations: options.skipComponentRelations, skipComponentRelations: options.skipComponentRelations })
//         };
//       }) || [];
//     } else if (isMediaAttribute(attr)) {
//       console.log(`Processing media ${key}`);
//       if (attr.multiple) {
//         processed[key] = data[key]?.map(media => ({
//           url: media.url.startsWith('/') ? computeUrl(media.url) : media.url,
//           name: media.name,
//           caption: media.caption,
//           hash: media.hash,
//           alternativeText: media.alternativeText,
//           createdAt: media.createdAt,
//           updatedAt: media.updatedAt,
//           publishedAt: media.publishedAt,
//         })) || [];
//       } else {
//         processed[key] = data[key] ? {
//           url: data[key].url.startsWith('/') ? computeUrl(data[key].url) : data[key].url,
//           name: data[key].name,
//           caption: data[key].caption,
//           hash: data[key].hash,
//           alternativeText: data[key].alternativeText,
//           createdAt: data[key].createdAt,
//           updatedAt: data[key].updatedAt,
//           publishedAt: data[key].publishedAt,
//         } : null;
//       }
//     }
//   }

//   return processed;
// }

// /**
//  * Group entry data by locale, comparing with published version to only include changed drafts
//  */
// function groupByLocale(entry, publishedEntry, model, alreadyProcessed, relations, exportAllLocales = true, skipRelations = false, skipComponentRelations = false) {
//   const result: {
//     draft?: Record<string, any>;
//     published?: Record<string, any>;
//   } = {};
  
//   // // Process main entry
//   // const mainLocale = entry.locale;
//   // // If no locale field exists or we're not exporting all locales, use 'default'
//   // const localeKey = (!mainLocale || !exportAllLocales) ? 'default' : mainLocale;

//   // Always remove localizations from the processed data
//   const processEntry = (data) => {
//     const processed = processDataWithSchema(data, model, relations, alreadyProcessed, { processLocalizations: true, skipRelations, skipComponentRelations });
//     delete processed.localizations;
//     return processed;
//   };

//   // Compare draft and published versions for each locale
//   const draftData = processEntry(entry);
//   const publishedData = publishedEntry ? processEntry(publishedEntry) : null;

//   // Only include draft if it's different from published
//   if (!publishedData || !areVersionsEqual(draftData, publishedData)) {
//     // result.draft = { [localeKey]: draftData };
//     result.draft = { default: draftData };
//   }

//   // Process localizations only if we're exporting all locales and we have a real locale
//   // if (mainLocale && exportAllLocales && entry.localizations?.length) {
//   if (exportAllLocales && entry.localizations?.length) {
//     for (const draftLoc of entry.localizations) {
//       const locale = draftLoc.locale;
//       if (!locale) continue;

//       // Find corresponding published localization
//       const publishedLoc = publishedEntry?.localizations?.find(l => l.locale === locale);
      
//       const draftLocData = processEntry(draftLoc);
//       const publishedLocData = publishedLoc ? processEntry(publishedLoc) : null;

//       // Only include draft if it's different from published
//       if (!publishedLocData || !areVersionsEqual(draftLocData, publishedLocData)) {
//         if (!result.draft) result.draft = {};
//         result.draft[locale] = draftLocData;
//       }
//     }
//   }

//   // Add published versions
//   if (publishedEntry) {
//     // result.published = { [localeKey]: processEntry(publishedEntry) };
//     result.published = { default: processEntry(publishedEntry) };

//     // Add published localizations only if we're exporting all locales and we have a real locale
//     // if (mainLocale && exportAllLocales && publishedEntry.localizations?.length) {
//     if (exportAllLocales && publishedEntry.localizations?.length) {
//       for (const publishedLoc of publishedEntry.localizations) {
//         const locale = publishedLoc.locale;
//         if (!locale) continue;
//         result.published[locale] = processEntry(publishedLoc);
//       }
//     }
//   }

//   return result;
// }

// /**
//  * Compare two versions excluding specific fields
//  */
// function areVersionsEqual(version1, version2, excludeFields = ['publishedAt']) {
//   const v1 = { ...version1 };
//   const v2 = { ...version2 };
  
//   excludeFields.forEach(field => {
//     delete v1[field];
//     delete v2[field];
//   });
  
//   return JSON.stringify(v1) === JSON.stringify(v2);
// }

// function validateIdField(model) {
//   const idField = getIdentifierField(model);
//   const attribute = model.attributes[idField];
  
//   if (!attribute) {
//     throw new Error(`IdField not found in model: Field '${idField}' is missing from model '${model.uid}'`);
//   }

//   // Check if the field is required and unique
//   if (!attribute.required || !attribute.unique) {
//     throw new Error(
//       `IdField misconfigured in model: Field '${idField}' in model '${model.uid}' must be both required and unique. ` +
//       `Current settings - required: ${!!attribute.required}, unique: ${!!attribute.unique}`
//     );
//   }





//   return idField;
// }

// async function exportSchema(
//   currentSlug: string,
//   exportedData: Record<string, any>,
//   relations: Relation,
//   alreadyProcessed: Relation,
//   options: {
//     documentIds?: string[];
//     applySearch: boolean;
//     search: any;
//     exportAllLocales: boolean;
//     exportRelations: boolean;
//     skipRelations: boolean;
//     skipComponentRelations: boolean;
//   }
// ) {
//   console.log(`\nProcessing slug: ${currentSlug}`);
//   const model = getModel(currentSlug);
//   if (!model || model.uid === 'admin::user') {
//     console.log('Skipping model:', currentSlug);
//     return;
//   }

//   // Validate idField configuration
//   validateIdField(model);

//   // Build populate object for relations and components
//   const populate = buildPopulateForModel(currentSlug);
//   console.log('Using populate:', JSON.stringify(populate, null, 2));

//   const documentIdFilter = options.documentIds?.length ? {
//     documentId: { $in: options.documentIds }
//   } : {};

//   const searchParams = options.applySearch && options.search ? (
//     typeof options.search === 'string' ? JSON.parse(options.search) : options.search
//   ) : {};

//   const filtersAndDocs = {
//     filters: {
//       ...searchParams.filters,
//       ...documentIdFilter
//     },
//     ...(options.applySearch && searchParams.sort && { sort: searchParams.sort })
//   };

//   // First get all draft versions
//   const draftEntries = await strapi.documents(currentSlug as UID.ContentType).findMany({
//     populate: {
//       ...populate,
//       localizations: {
//         populate: populate
//       }
//     },
//     status: 'draft',
//     ...filtersAndDocs
//   });

//   console.log(`Found ${draftEntries.length} draft entries`);

//   exportedData[currentSlug] = [];

//   // Process each draft entry and its corresponding published version
//   for (const draftEntry of draftEntries) {
//     console.log(`\nProcessing entry ${draftEntry.id}`);
    
//     // Get the published version using the same documentId
//     const publishedEntry = await strapi.documents(currentSlug as UID.ContentType).findOne({
//       documentId: draftEntry.documentId,
//       status: 'published',
//       populate: {
//         ...populate,
//         ...(options.exportAllLocales && { 
//           localizations: {
//             populate: populate
//           }
//         })
//       }
//     });

//     const versions = groupByLocale(draftEntry, publishedEntry, model, alreadyProcessed, relations, options.exportAllLocales, options.skipRelations, options.skipComponentRelations);
    
//     // Only add the entry if there are actual differences
//     if (versions.draft || versions.published) {
//       exportedData[currentSlug].push(versions);
      
//       if (!alreadyProcessed[currentSlug]) {
//         alreadyProcessed[currentSlug] = [];
//       }
//       alreadyProcessed[currentSlug].push(draftEntry.documentId);
//     }
//   }
// }

// async function exportDataV3({
//   slug,
//   search,
//   applySearch,
//   exportPluginsContentTypes,
//   documentIds,
//   maxDepth = 20,
//   exportAllLocales = true,
//   exportRelations = false,
//   deepPopulateRelations = false,
//   deepPopulateComponentRelations = false
// }) {
//   console.log('exportDataV3 called with:', { slug, search, applySearch, exportPluginsContentTypes, documentIds });
  
//   const slugsToExport = 
//     slug === CustomSlugs.WHOLE_DB ? 
//     getAllSlugs({ includePluginsContentTypes: exportPluginsContentTypes }) : 
//     [CustomSlugToSlug[slug] || slug];
  
//   console.log('Slugs to export:', slugsToExport);

//   const exportedData = {};
//   let currentRelations: Relation = {};
//   let alreadyProcessed: Relation = {};
  
//   for (const currentSlug of slugsToExport) {
//     await exportSchema(currentSlug, exportedData, currentRelations, alreadyProcessed, {
//       documentIds,
//       applySearch,
//       search,
//       exportAllLocales,
//       exportRelations,
//       skipRelations: false,
//       skipComponentRelations: false
//     });
//   }

//   delete exportedData['admin::user'];

//   const processedRelations = {};

//   let loopCount = 0;
//   while (Object.keys(currentRelations).length > 0 && exportRelations && loopCount < maxDepth) {
//     loopCount++;
//     const nextRelations = {};
//     for (const [key, value] of Object.entries(currentRelations)) {
//       await exportSchema(key, exportedData, nextRelations, alreadyProcessed, {
//         documentIds: value,
//         applySearch: false,
//         search: {},
//         exportAllLocales,
//         exportRelations,
//         skipRelations: !deepPopulateRelations,
//         skipComponentRelations: !deepPopulateComponentRelations
//       });
//     }

//     processedRelations[loopCount] = currentRelations;
//     // remove any ids in nextRelations that are already in currentRelations, since they've already been processed
//     // also delete 'admin::user' from nextRelations
//     // then set currentRelations to nextRelations
//     currentRelations = Object.fromEntries(
//       Object.entries(nextRelations).filter(([key, value]) => {
//         // Ensure both arrays exist before comparing
//         const currentValues = currentRelations[key] || [];
//         // Check if any values in nextRelations are not in currentRelations
//         if (key === 'admin::user') {
//           return false;
//         }
//         return Array.isArray(value) && value.some(id => !currentValues.includes(id));
//       }).map(([key, value]) => [key, Array.isArray(value) ? value : []])
//     ) as Relation;

//     if (loopCount === maxDepth) {
//       console.warn(`Export relations loop limit reached (${maxDepth} iterations). Some relations may not be fully exported.`);
//     }
//   }

//   return JSON.stringify({
//     version: 3,
//     data: exportedData
//   }, null, '\t');
// }

// export {
//   exportDataV3,
//   getIdentifierField,
//   processDataWithSchema
// }; 
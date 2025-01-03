import { UID } from '@strapi/types';

export interface ExportOptions {
    documentIds?: string[];
    applySearch: boolean;
    search: any;
    exportAllLocales: boolean;
    exportRelations: boolean;
    skipRelations: boolean;
    skipComponentRelations: boolean;
}

export class ExportContext {
    private processedDocumentIds: Set<string> = new Set();
    private relations: Record<string, string[]> = {};

    constructor(
        public readonly options: ExportOptions,
        public readonly exportedData: Record<string, any> = {},
        public readonly processedRelations: Record<number, Record<string, string[]>> = {}
    ) {}

    recordProcessed(documentId: string) {
        this.processedDocumentIds.add(documentId);
    }

    wasProcessed(documentId: string): boolean {
        return this.processedDocumentIds.has(documentId);
    }

    addRelation(contentType: UID.ContentType, documentId: string) {
        if (!this.relations[contentType]) {
            this.relations[contentType] = [];
        }
        if (!this.relations[contentType].includes(documentId)) {
            this.relations[contentType].push(documentId);
        }
    }

    getRelations() {
        return this.relations;
    }

    clearRelations() {
        this.relations = {};
    }

    setSkipRelations(skip: boolean) {
        this.options.skipRelations = skip;
    }

    setSkipComponentRelations(skip: boolean) {
        this.options.skipComponentRelations = skip;
    }

    setDocumentIds(documentIds: string[]) {
        this.options.documentIds = documentIds;
    }
} 
import { Schema } from '@strapi/types';

export function attributeIsUnique(attribute: Schema.Attribute.AnyAttribute): attribute is Schema.Attribute.OfType<'string' | 'text' | 'email' | 'integer' | 'biginteger' | 'float' | 'decimal'> {
    return ['string', 'text', 'email', 'integer', 'biginteger', 'float', 'decimal'].includes(attribute.type);
}

export function getIdentifierField(model: Schema.Schema): string {
    console.log('getIdentifierField for model:', model.uid);

    // Check for configured idField in plugin options
    if (model.pluginOptions?.['import-export-entries']?.idField) {
        const configuredField = model.pluginOptions['import-export-entries'].idField;
        console.log('Using configured idField:', configuredField);

        // Validate the configured field exists and is properly set up
        const attribute = model.attributes[configuredField];
        if (!attribute) {
            throw new Error(`Configured idField '${configuredField}' not found in model '${model.uid}'`);
        }
        if (attributeIsUnique(attribute) && (!attribute.required || !attribute.unique)) {
            throw new Error(
                `Configured idField '${configuredField}' in model '${model.uid}' must be both required and unique. ` +
                `Current settings - required: ${!!attribute.required}, unique: ${!!attribute.unique}`
            );
        }
        return configuredField;
    }

    // Check for standard identifier fields in order
    const attributes = model.attributes || {};
    console.log('Looking for identifier in attributes:', Object.keys(attributes));

    if (attributes.uid) return 'uid';
    if (attributes.name) return 'name';
    if (attributes.title) return 'title';

    console.log('Falling back to id');
    return 'id';
} 
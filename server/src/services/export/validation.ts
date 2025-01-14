import { Schema } from '@strapi/types';
import { attributeIsUnique, getIdentifierField } from '../../utils/identifiers';

export function validateIdField(model: Schema.Schema) {
    const idField = getIdentifierField(model);
    const attribute: Schema.Attribute.AnyAttribute = model.attributes[idField];

    if (!attribute) {
        throw new Error(`IdField not found in model: Field '${idField}' is missing from model '${model.uid}'`);
    }

    if (!attributeIsUnique(attribute) && attribute.type !== 'uid') {
        throw new Error(
            `IdField type not supported in model: Field '${idField}' in model '${model.uid}' must have a unique option. ` +
            `Current settings - type: ${attribute.type}`
        );
    }

    if ((attributeIsUnique(attribute) && (!attribute.required || !attribute.unique)) || 
        (attribute.type === 'uid' && !attribute.required)) {
        throw new Error(
            `IdField misconfigured in model: Field '${idField}' in model '${model.uid}' must be ${attribute.type === 'uid' ? 'required' : 'both required and unique'}. ` +
            `Current settings - required: ${!!attribute.required}${attribute.type !== 'uid' ? `, unique: ${!!attribute.unique}` : 'true'}`
        );
    }

    return idField;
}
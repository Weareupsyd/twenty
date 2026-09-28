import { defineObject, FieldType } from 'twenty-sdk/define';
import {
  GD_CONTENT,
  GD_ERROR,
  GD_FORMAT,
  GD_GENERATED_AT,
  GD_KIND,
  GD_OBJECT,
  GD_POLICY_NO,
  GD_REFERENCE,
  GD_STATUS,
} from 'src/constants/universal-identifiers';

export const GENERATED_DOCUMENT_UNIVERSAL_IDENTIFIER = GD_OBJECT;

export default defineObject({
  universalIdentifier: GENERATED_DOCUMENT_UNIVERSAL_IDENTIFIER,
  nameSingular: 'generatedDocument',
  namePlural: 'generatedDocuments',
  labelSingular: 'Generated document',
  labelPlural: 'Generated documents',
  description:
    'A document rendered from a template; PDF and Word are served from its content',
  icon: 'IconFileDescription',
  labelIdentifierFieldMetadataUniversalIdentifier: GD_REFERENCE,
  fields: [
    {
      universalIdentifier: GD_REFERENCE,
      name: 'reference',
      type: FieldType.TEXT,
      label: 'Document ref',
      description: 'Generated automatically (DOC-XXXXXX).',
      icon: 'IconHash',
      isUnique: true,
      isSearchable: true,
    },
    {
      universalIdentifier: GD_KIND,
      name: 'kind',
      type: FieldType.SELECT,
      label: 'Kind',
      icon: 'IconFileText',
      defaultValue: "'POLICY_CERTIFICATE'",
      options: [
        {
          value: 'POLICY_CERTIFICATE',
          label: 'Policy certificate',
          position: 0,
          color: 'blue',
        },
      ],
    },
    {
      universalIdentifier: GD_FORMAT,
      name: 'format',
      type: FieldType.SELECT,
      label: 'Format',
      description: 'TEXT or HTML, taken from the template at generation time.',
      icon: 'IconCode',
      defaultValue: "'TEXT'",
      options: [
        { value: 'TEXT', label: 'Text', position: 0, color: 'blue' },
        { value: 'HTML', label: 'HTML', position: 1, color: 'purple' },
      ],
    },
    {
      universalIdentifier: GD_POLICY_NO,
      name: 'policyNo',
      type: FieldType.TEXT,
      label: 'Policy no',
      description: 'Protecta policy this document belongs to.',
      icon: 'IconHash',
      isSearchable: true,
    },
    {
      universalIdentifier: GD_STATUS,
      name: 'status',
      type: FieldType.SELECT,
      label: 'Status',
      icon: 'IconProgress',
      defaultValue: "'PENDING'",
      options: [
        { value: 'PENDING', label: 'Pending', position: 0, color: 'yellow' },
        {
          value: 'GENERATED',
          label: 'Generated',
          position: 1,
          color: 'green',
        },
        { value: 'FAILED', label: 'Failed', position: 2, color: 'red' },
      ],
    },
    {
      universalIdentifier: GD_CONTENT,
      name: 'content',
      type: FieldType.TEXT,
      label: 'Content',
      description: 'Rendered document text; PDF and Word are produced from this.',
      icon: 'IconAlignLeft',
    },
    {
      universalIdentifier: GD_ERROR,
      name: 'error',
      type: FieldType.TEXT,
      label: 'Error',
      icon: 'IconAlertCircle',
    },
    {
      universalIdentifier: GD_GENERATED_AT,
      name: 'generatedAt',
      type: FieldType.DATE_TIME,
      label: 'Generated at',
      icon: 'IconClock',
    },
  ],
});

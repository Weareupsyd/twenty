import { defineObject, FieldType } from 'twenty-sdk/define';
import {
  DT_BODY,
  DT_FORMAT,
  DT_KIND,
  DT_NAME,
  DT_NOTES,
  DT_OBJECT,
} from 'src/constants/universal-identifiers';

export const DOCUMENT_TEMPLATE_UNIVERSAL_IDENTIFIER = DT_OBJECT;

export default defineObject({
  universalIdentifier: DOCUMENT_TEMPLATE_UNIVERSAL_IDENTIFIER,
  nameSingular: 'documentTemplate',
  namePlural: 'documentTemplates',
  labelSingular: 'Document template',
  labelPlural: 'Document templates',
  description:
    'Template body with {{placeholders}} rendered into generated documents',
  icon: 'IconTemplate',
  labelIdentifierFieldMetadataUniversalIdentifier: DT_NAME,
  fields: [
    {
      universalIdentifier: DT_NAME,
      name: 'name',
      type: FieldType.TEXT,
      label: 'Name',
      icon: 'IconNotes',
      isSearchable: true,
    },
    {
      universalIdentifier: DT_KIND,
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
      universalIdentifier: DT_FORMAT,
      name: 'format',
      type: FieldType.SELECT,
      label: 'Format',
      description:
        'TEXT renders plain lines into PDF and Word; HTML renders the body as a styled web document (printable from the browser).',
      icon: 'IconCode',
      defaultValue: "'TEXT'",
      options: [
        { value: 'TEXT', label: 'Text', position: 0, color: 'blue' },
        { value: 'HTML', label: 'HTML', position: 1, color: 'purple' },
      ],
    },
    {
      universalIdentifier: DT_BODY,
      name: 'body',
      type: FieldType.TEXT,
      label: 'Template body',
      description:
        'Document text with {{placeholders}}. Leave empty to use the built-in default template.',
      icon: 'IconAlignLeft',
    },
    {
      universalIdentifier: DT_NOTES,
      name: 'notes',
      type: FieldType.TEXT,
      label: 'Notes',
      icon: 'IconNotes',
    },
  ],
});

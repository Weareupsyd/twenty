import {
  defineField,
  FieldType,
  OnDeleteAction,
  RelationType,
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
} from 'twenty-sdk/define';
import {
  INSURANCE_POLICY,
  P_AGENT,
  PERSON_AGENT_POLICIES,
} from 'src/constants/universal-identifiers';

export default defineField({
  universalIdentifier: P_AGENT,
  objectUniversalIdentifier: INSURANCE_POLICY,
  type: FieldType.RELATION,
  name: 'agent',
  label: 'Agent',
  description:
    'Agent or broker attributed to this policy; accrues commission automatically.',
  icon: 'IconUser',
  relationTargetObjectMetadataUniversalIdentifier:
    STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.person.universalIdentifier,
  relationTargetFieldMetadataUniversalIdentifier: PERSON_AGENT_POLICIES,
  universalSettings: {
    relationType: RelationType.MANY_TO_ONE,
    onDelete: OnDeleteAction.SET_NULL,
    joinColumnName: 'agentId',
  },
});

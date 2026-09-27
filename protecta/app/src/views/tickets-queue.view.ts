import { defineView, ViewType } from 'twenty-sdk/define';
import {
  SUPPORT_TICKET,
  TICKETS_QUEUE,
  T_CHANNEL,
  T_DESCRIPTION,
  T_PRIORITY,
  T_REQUESTER_PHONE,
  T_STATUS,
  T_SUBJECT,
  T_TICKET_REF,
  VIEW_TICKETS_QUEUE_COL0,
  VIEW_TICKETS_QUEUE_COL1,
  VIEW_TICKETS_QUEUE_COL2,
  VIEW_TICKETS_QUEUE_COL3,
  VIEW_TICKETS_QUEUE_COL4,
  VIEW_TICKETS_QUEUE_COL5,
  VIEW_TICKETS_QUEUE_COL6,
} from 'src/constants/universal-identifiers';

export default defineView({
  universalIdentifier: TICKETS_QUEUE,
  name: 'Tickets queue',
  objectUniversalIdentifier: SUPPORT_TICKET,
  type: ViewType.TABLE,
  icon: 'IconMessage',
  position: 0,
  fields: [
    { universalIdentifier: VIEW_TICKETS_QUEUE_COL0, fieldMetadataUniversalIdentifier: T_TICKET_REF, position: 0, isVisible: true, size: 160 },
    { universalIdentifier: VIEW_TICKETS_QUEUE_COL1, fieldMetadataUniversalIdentifier: T_SUBJECT, position: 1, isVisible: true, size: 240 },
    { universalIdentifier: VIEW_TICKETS_QUEUE_COL2, fieldMetadataUniversalIdentifier: T_CHANNEL, position: 2, isVisible: true, size: 130 },
    { universalIdentifier: VIEW_TICKETS_QUEUE_COL3, fieldMetadataUniversalIdentifier: T_STATUS, position: 3, isVisible: true, size: 130 },
    { universalIdentifier: VIEW_TICKETS_QUEUE_COL4, fieldMetadataUniversalIdentifier: T_PRIORITY, position: 4, isVisible: true, size: 120 },
    { universalIdentifier: VIEW_TICKETS_QUEUE_COL5, fieldMetadataUniversalIdentifier: T_REQUESTER_PHONE, position: 5, isVisible: true, size: 150 },
    { universalIdentifier: VIEW_TICKETS_QUEUE_COL6, fieldMetadataUniversalIdentifier: T_DESCRIPTION, position: 6, isVisible: true, size: 260 },
  ],
});

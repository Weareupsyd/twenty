import { defineView, ViewType } from 'twenty-sdk/define';
import {
  VEHICLE,
  VEHICLES_ALL,
  VIEW_VEHICLES_ALL_COL0,
  VIEW_VEHICLES_ALL_COL1,
  VIEW_VEHICLES_ALL_COL2,
  VIEW_VEHICLES_ALL_COL3,
  VIEW_VEHICLES_ALL_COL4,
  VIEW_VEHICLES_ALL_COL5,
  VIEW_VEHICLES_ALL_COL6,
  V_MAKE,
  V_MODEL,
  V_OWNER_PHONE,
  V_PLATE,
  V_PROTECTA_REF,
  V_VALUE_UGX,
  V_YEAR,
} from 'src/constants/universal-identifiers';

export default defineView({
  universalIdentifier: VEHICLES_ALL,
  name: 'All vehicles',
  objectUniversalIdentifier: VEHICLE,
  type: ViewType.TABLE,
  icon: 'IconCar',
  position: 0,
  fields: [
    { universalIdentifier: VIEW_VEHICLES_ALL_COL0, fieldMetadataUniversalIdentifier: V_PLATE, position: 0, isVisible: true, size: 140 },
    { universalIdentifier: VIEW_VEHICLES_ALL_COL1, fieldMetadataUniversalIdentifier: V_MAKE, position: 1, isVisible: true, size: 140 },
    { universalIdentifier: VIEW_VEHICLES_ALL_COL2, fieldMetadataUniversalIdentifier: V_MODEL, position: 2, isVisible: true, size: 140 },
    { universalIdentifier: VIEW_VEHICLES_ALL_COL3, fieldMetadataUniversalIdentifier: V_YEAR, position: 3, isVisible: true, size: 90 },
    { universalIdentifier: VIEW_VEHICLES_ALL_COL4, fieldMetadataUniversalIdentifier: V_VALUE_UGX, position: 4, isVisible: true, size: 150 },
    { universalIdentifier: VIEW_VEHICLES_ALL_COL5, fieldMetadataUniversalIdentifier: V_OWNER_PHONE, position: 5, isVisible: true, size: 150 },
    { universalIdentifier: VIEW_VEHICLES_ALL_COL6, fieldMetadataUniversalIdentifier: V_PROTECTA_REF, position: 6, isVisible: true, size: 200 },
  ],
});

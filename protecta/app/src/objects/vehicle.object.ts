import { defineObject, FieldType, NumberDataType } from 'twenty-sdk/define';
import {
  V_MAKE,
  V_MODEL,
  V_OWNER_PHONE,
  V_PLATE,
  V_PROTECTA_REF,
  V_VALUE_UGX,
  V_YEAR,
  VEHICLE,
} from 'src/constants/universal-identifiers';

export const VEHICLE_UNIVERSAL_IDENTIFIER = VEHICLE;

export default defineObject({
  universalIdentifier: VEHICLE_UNIVERSAL_IDENTIFIER,
  nameSingular: 'vehicle',
  namePlural: 'vehicles',
  labelSingular: 'Vehicle',
  labelPlural: 'Vehicles',
  description: 'Insured vehicle (Protecta Bode)',
  icon: 'IconCar',
  labelIdentifierFieldMetadataUniversalIdentifier: V_PLATE,
  fields: [
    {
      universalIdentifier: V_PROTECTA_REF,
      name: 'protectaRef',
      type: FieldType.TEXT,
      label: 'Protecta ref',
      description: 'Idempotency key: owner phone + plate',
      icon: 'IconHash',
      isSearchable: true,
    },
    {
      universalIdentifier: V_PLATE,
      name: 'plate',
      type: FieldType.TEXT,
      label: 'Number plate',
      icon: 'IconBadge',
      isSearchable: true,
    },
    {
      universalIdentifier: V_MAKE,
      name: 'make',
      type: FieldType.TEXT,
      label: 'Make',
      icon: 'IconCar',
    },
    {
      universalIdentifier: V_MODEL,
      name: 'model',
      type: FieldType.TEXT,
      label: 'Model',
      icon: 'IconCar',
    },
    {
      universalIdentifier: V_YEAR,
      name: 'year',
      type: FieldType.NUMBER,
      label: 'Year',
      icon: 'IconCalendar',
      universalSettings: { dataType: NumberDataType.INT },
    },
    {
      universalIdentifier: V_VALUE_UGX,
      name: 'valueUgx',
      type: FieldType.NUMBER,
      label: 'Value (UGX)',
      icon: 'IconCash',
      universalSettings: { dataType: NumberDataType.BIGINT },
    },
    {
      universalIdentifier: V_OWNER_PHONE,
      name: 'ownerPhone',
      type: FieldType.TEXT,
      label: 'Owner phone',
      icon: 'IconPhone',
      isSearchable: true,
    },
  ],
});

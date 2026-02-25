/**
 * API型定義
 */

export interface Food {
  food_group: string;
  REFUSE: number | null;
  food_number: string;
  food_name: string;
  food_name_en: string;
  WATER: number | null;
  'PROT-': number | null;
  'FAT-': number | null;
  'FIB-': number | null;
  ASH: number | null;
  ENERC_KCAL: number | null;
  ME_KCAL_100G: number | null;
  CA: number | null;
  P: number | null;
  NA: number | null;
  K: number | null;
  MG: number | null;
  FE: number | null;
  ZN: number | null;
  CU: number | null;
  MN: number | null;
  ID: number | null;
  ID_estimated: boolean;
  SE: number | null;
  CR: number | null;
  MO: number | null;
  usda_selenium_ug: number | null;
  RETOL: number | null;
  VITD: number | null;
  TOCPHA: number | null;
  THIA: number | null;
  RIBF: number | null;
  NIA: number | null;
  VITB6A: number | null;
  VITB12: number | null;
  FOL: number | null;
  PANTAC: number | null;
  VITK: number | null;
  BIOT: number | null;
  usda_choline_mg: number | null;
  usda_vitamin_k_ug: number | null;
  usda_vitamin_c_mg: number | null;
  ILE: number | null;
  LEU: number | null;
  LYS: number | null;
  MET: number | null;
  CYS: number | null;
  AAS: number | null;
  PHE: number | null;
  TYR: number | null;
  AAA: number | null;
  THR: number | null;
  TRP: number | null;
  VAL: number | null;
  HIS: number | null;
  ARG: number | null;
  FACID: number | null;
  FAPU: number | null;
  FAPUN3: number | null;
  FAPUN6: number | null;
  F18D2N6: number | null;
  F18D3N3: number | null;
  F20D5N3: number | null;
  F22D6N3: number | null;
  F20D4N6: number | null;
  score: number | null;
  usda_fdc_id: string | null;
  tag_name: string | null;
  diff: string | null;
  search_keywords: string | null;
}

export type FilterOperator = 'eq' | 'gte' | 'gt' | 'lte' | 'lt';

export interface FilterCondition {
  column: string;
  operator: FilterOperator;
  value: number | string;
}

export interface SortCondition {
  column: string;
  order: 'asc' | 'desc';
}

export interface SearchRequest {
  filters?: FilterCondition[];
  sort?: SortCondition;
  limit?: number;
  offset?: number;
}

export interface SearchResponse {
  total: number;
  foods: Food[];
}

export interface GetFoodsResponse {
  foods: Food[];
}

export interface ApiError {
  error: string;
  message?: string;
}

export interface Env {
  API_KEYS: string; // JSON形式: [[ACCESS_KEY, SECRET_KEY], ...]
}

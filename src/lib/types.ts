export interface Client {
  id: number;
  short_code: string;
  name: string;
  entity_name: string;
}

export interface DailySummary {
  date: string;
  client_id: number;
  client_name: string;
  short_code: string;
  total_spend: number;
  total_revenue: number;
  spend_with_fee: number;
  true_roas: number;
  profit: number;
  keylime_cut: number;
  rolling_3d_roas?: number;
}

export interface AdPerformance {
  ad_name: string;
  client_name: string;
  short_code: string;
  campaign_type: string;
  batch: string;
  ad_delivery: string;
  attribution_setting: string;
  total_spend: number;
  spend_3d: number;
  spend_7d: number;
  spend_14d: number;
  total_results: number;
  results_3d: number;
  results_7d: number;
  results_14d: number;
  cpp: number;
  cpp_3d: number;
  frequency: number;
  actblue_revenue: number;
  roi: number;
  first_seen: string;
  is_new: boolean;
  trend: 'up' | 'down' | 'flat' | 'new';
  recommendation: 'KILL' | 'OK';
  kill_reason?: string;
}

export interface CampaignPerformance {
  campaign: string;
  client_name: string;
  short_code: string;
  ad_count: number;
  total_spend: number;
  spend_72h: number;
  total_revenue: number;
  revenue_72h: number;
  total_results: number;
  results_72h: number;
  roi_72h: number;
  cpp_72h: number;
  avg_cpp_portfolio: number;
  recommendation: 'SCALE' | 'DROP' | 'HOLD';
  reason: string;
  ads: string[];
}

export interface HistoricalPoint {
  date: string;
  client_name: string;
  short_code: string;
  true_roas: number;
  total_spend: number;
  total_revenue: number;
  spend_with_fee: number;
}

export interface UploadResult {
  success: boolean;
  filename: string;
  type: string;
  rowsProcessed: number;
  errors: string[];
}

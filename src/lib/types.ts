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
  spend_1d: number;
  spend_3d: number;
  spend_7d: number;
  spend_14d: number;
  spend_custom?: number;
  total_results: number;
  results_1d: number;
  results_3d: number;
  results_7d: number;
  results_14d: number;
  results_custom?: number;
  link_clicks: number;
  link_clicks_1d: number;
  link_clicks_3d: number;
  link_clicks_7d: number;
  link_clicks_14d: number;
  link_clicks_custom?: number;
  cpp: number;
  cpp_3d: number;
  frequency: number;
  actblue_revenue: number;
  actblue_revenue_1d: number;
  actblue_revenue_3d: number;
  actblue_revenue_7d: number;
  actblue_revenue_14d: number;
  actblue_revenue_custom?: number;
  roi: number;
  roi_1d: number;
  roi_3d: number;
  roi_7d: number;
  roi_14d: number;
  roi_custom?: number;
  first_seen: string;
  is_new: boolean;
  trend: 'up' | 'down' | 'flat' | 'new';
  recommendation: 'SCALE' | 'DROP' | 'KILL' | 'HOLD';
  rec_reason?: string;
}

export interface ClientGroup {
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

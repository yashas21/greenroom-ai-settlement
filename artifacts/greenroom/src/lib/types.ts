export type Status = "booked" | "advanced" | "day_of" | "settled" | "closed";

export type DealType = "flat" | "percentage_of_gross" | "percentage_of_net" | "vs" | "door";

export type SettlementStage =
  | "draft" | "submitted" | "in_review" | "signed" | "disputed"
  | "revised" | "finalized" | "paid" | "voided";

export interface Show {
  id: string;
  venueId: string;
  artistId: string;
  date: string;
  status: Status;
  doorsTime: string | null;
  setTime: string | null;
  openerArtistId: string | null;
  roomConfig: "standing" | "seated" | "mixed";
  internalNotes: string | null;
  createdAt: string;
}

export interface Artist {
  id: string;
  name: string;
  agentId: string | null;
  managerEmail: string | null;
  genre: string | null;
  priorShowCount: number;
}

export interface Agent {
  id: string;
  name: string;
  agencyId: string | null;
  email: string;
  phone: string | null;
  preferencesNotes: string | null;
}

export interface Agency {
  id: string;
  name: string;
}

export interface Venue {
  id: string;
  name: string;
  capacity: number;
  city: string;
  state: string;
}

export interface Deal {
  id: string;
  showId: string;
  dealType: DealType;
  guaranteeAmount: number | null;
  percentage: number | null;
  percentageBasis: "gross" | "net" | null;
  expenseCap: number | null;
  hospitalityCap: number | null;
  bonusesJson: string | null;
  dealNotesFreetext: string | null;
  createdAt: string;
}

export interface TicketSale {
  id: string;
  showId: string;
  qty: number;
  gross: number;
  fees: number;
  capturedAt: string;
}

export interface Comp {
  id: string;
  showId: string;
  category: "artist_gl" | "label" | "press" | "venue_staff" | "sponsor" | "promo" | "other";
  count: number;
  faceValue: number;
  countsTowardGross: boolean;
  notes: string | null;
}

export interface Expense {
  id: string;
  showId: string;
  category: "production" | "sound" | "lights" | "hospitality" | "marketing" | "backline" | "security" | "other";
  amount: number;
  description: string | null;
  approved: boolean;
  absorbedByVenue: boolean;
  enteredByUserId: string | null;
  enteredAt: string;
}

export interface Settlement {
  id: string;
  showId: string;
  status: SettlementStage;
  draftedAt: string | null;
  submittedAt: string | null;
  reviewStartedAt: string | null;
  signedAt: string | null;
  disputedAt: string | null;
  revisedAt: string | null;
  finalizedAt: string | null;
  paidAt: string | null;
  completedAt: string | null;
  completedByUserId: string | null;
  grossBoxOffice: number | null;
  netBoxOffice: number | null;
  totalExpenses: number | null;
  totalToArtist: number | null;
  calculationJson: string | null;
  recoupsJson: string | null;
  signoffText: string | null;
  notes: string | null;
}

export type Bonus =
  | { type: "gross_threshold"; label: string; threshold: number; amount: number; stacks?: boolean }
  | { type: "sellout"; label: string; amount: number }
  | { type: "attendance_threshold"; label: string; threshold: number; amount: number }
  | { type: "tier_ratchet"; label: string; tiers: { from: number; to: number | null; percentage: number }[] };

export type Recoup = {
  id: string;
  category: "marketing" | "hospitality_overage" | "production_overage" | "prior_advance" | "damages" | "other";
  label: string;
  amount: number;
  status: "agreed" | "disputed" | "withdrawn";
};

export type ShowTense = "past" | "upcoming";

export interface ShowListRow {
  show: Show;
  artist: Artist | null;
  agent: Agent | null;
  deal: Deal | null;
  settlement: Settlement | null;
  isUnsupportedDeal: boolean;
  isDisputed: boolean;
  tense: ShowTense;
  switchStatus: SwitchStatus | null;
  expenseCategories: string[];
  recoupCategories: string[];
  disputedRecoupCategories: string[];
}

export type SwitchStatus = "suggested" | "accepted" | "declined";
export type ConfidenceTier = "A" | "B" | "C" | "D";

export interface SwitchSuggestion {
  id: string;
  showId: string;
  dealId: string;
  suggestedAt: string;
  dealTypeFrom: DealType;
  shape: "flat" | "door_hybrid";
  suggestedFlat: number | null;
  doorFloor: number | null;
  doorSplitPct: number | null;
  doorExpenseCap: number | null;
  confidenceTier: ConfidenceTier;
  bandLow: number | null;
  bandHigh: number | null;
  sampleSize: number;
  basis: string;
  status: SwitchStatus;
  decidedAt: string | null;
}

export interface ShowDetail {
  show: Show;
  artist: Artist | null;
  agent: Agent | null;
  agency: Agency | null;
  deal: Deal | null;
  settlement: Settlement | null;
  venue: Venue | null;
  ticketSales: TicketSale[];
  expenses: Expense[];
  comps: Comp[];
  recoups: Recoup[];
  switchSuggestion: SwitchSuggestion | null;
  isUnsupportedDeal: boolean;
  isDisputed: boolean;
}

export type AttentionKind =
  | "notes_say_closed_but_status_open"
  | "show_settled_no_settlement"
  | "disputed_recoups_but_signed"
  | "stale_disputed";

export interface AttentionItem {
  kind: AttentionKind;
  showId: string;
  artistName: string | null;
  date: string;
  status: string;
  settlementStatus: string | null;
  detail: string;
  evidence?: string;
}

export type LlmProvider = "anthropic" | "openai";

export interface LlmProviderStatus {
  configured: boolean;
  source: "settings" | "env" | "none";
  model: string;
}

export interface LlmStatus {
  activeProvider: LlmProvider;
  activeModel: string;
  source: "settings" | "env" | "none";
  hasKey: boolean;
  providers: Record<LlmProvider, LlmProviderStatus>;
  models: Record<LlmProvider, string[]>;
}

export interface SaveLlmSettingsInput {
  provider?: LlmProvider;
  anthropicApiKey?: string | null;
  anthropicModel?: string;
  openaiApiKey?: string | null;
  openaiModel?: string;
}

export interface InsightsCell {
  dealType: string;
  bucket: string;
  count: number;
  attentionCount: number;
  topKind: AttentionKind | null;
  topKindCount: number;
  byKind: Record<AttentionKind, number>;
  bubbles: { theme: string; count: number }[];
  sampleSize: number;
  llmError: string | null;
}

export interface SwitchSavingsItem {
  showId: string;
  date: string;
  artistName: string | null;
  dealType: DealType;
  switchShape: "flat" | "door_hybrid";
  confidenceTier: ConfidenceTier;
  actualToArtist: number;
  counterfactualToArtist: number;
  moneySavedToVenue: number;
  estimatedMinutesSpent: number;
  estimatedMinutesUnderSwitch: number;
  minutesSaved: number;
  hadDispute: boolean;
  disputedRecoupCount: number;
  notesParagraphs: number;
  signoffParagraphs: number;
  totalRecoups: number;
  grossBoxOffice: number;
  totalExpenses: number;
  breakdown: {
    actual: {
      gross: number;
      expenses: number;
      recoupTotal: number;
      recoupLines: { label: string; amount: number; status: string }[];
      payout: number;
      settlementStatus: string;
    };
    counterfactual: {
      shape: "flat" | "door_hybrid";
      flat: number | null;
      doorFloor: number | null;
      doorSplitPct: number | null;
      doorExpenseCap: number | null;
      projectedPayout: number;
      basis: string;
    };
    timeSavedRationale: string;
    moneyRationale: string;
  };
}

export interface SwitchSavingsPayload {
  generatedAt: string;
  windowMonths: number;
  totalCandidates: number;
  totalMoneySavedToVenue: number;
  totalMinutesSaved: number;
  items: SwitchSavingsItem[];
}

export interface InsightsPayload {
  generatedAt: string;
  enrichmentCoverage: { withSummary: number; total: number };
  dealTypes: string[];
  buckets: string[];
  cells: InsightsCell[];
}

export interface ArtistRow {
  artist: Artist;
  agent: Agent | null;
  agency: Agency | null;
  showCount: number;
  lastShowDate: string | null;
  topDealType: string | null;
  dealTypes: { dealType: string; count: number }[];
  topPositive: string | null;
  topNegative: string | null;
  attentionCount: number;
}

export interface Reports {
  dealTypeCounts: Record<string, number>;
  totalDeals: number;
  inAppToolUsageRate: number;
  settlementStatus: Record<string, number>;
  totalSettlements: number;
  disputedRate: number;
  totalGross: number;
  totalToArtists: number;
  showCount: number;
  settledCount: number;
  dealsWithBonuses: number;
  totalRecoupValue: number;
  disputedRecoupValue: number;
  settlementsWithRecoups: number;
  totalCompTickets: number;
  totalCompFaceValue: number;
  compsByCategory: Record<string, number>;
}

export interface DealAnalysis {
  totalDeals: number;
  byComplexity: {
    bucket: "simple" | "medium" | "complex";
    count: number;
    pct: number;
    avgPayout: number;
    inToolCount: number;
    spreadsheetCount: number;
  }[];
  bySize: {
    bucket: string;
    count: number;
    pct: number;
    avgGross: number;
    avgToArtist: number;
    disputeRate: number;
    losingMoneyCount: number;
    profitN: number;
  }[];
  byProfitability: {
    profitable: { count: number; disputed: number; disputeRate: number };
    unprofitable: { count: number; disputed: number; disputeRate: number };
  };
  costs: {
    totalExpenses: number;
    expensesByCategory: Record<string, number>;
    totalRecoups: number;
    disputedRecoupValue: number;
    recoupsByCategory: Record<string, { amount: number; disputedAmount: number }>;
  };
  revenue: {
    byDealType: Record<
      string,
      { gross: number; netToVenue: number; toArtist: number; count: number }
    >;
    months: {
      month: string;
      label: string;
      gross: number;
      netToVenue: number;
      toArtist: number;
      byType: Record<string, number>;
    }[];
    crossTabBySizeAndType: {
      dealTypes: string[];
      buckets: string[];
      attentionKinds: AttentionKind[];
      cells: {
        dealType: string;
        bucket: string;
        count: number;
        settledN: number;
        profitN: number;
        losingMoneyCount: number;
        disputed: number;
        losingMoneyRate: number;
        disputeRate: number;
        attentionCount: number;
        attentionRate: number;
        attentionByKind: Record<AttentionKind, number>;
      }[];
    };
  };
}

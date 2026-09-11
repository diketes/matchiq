export type Sport = 'football' | 'tennis';
export type MatchState = 'pre' | 'in' | 'post';

export interface SetScore { games: number; tiebreak?: number; won?: boolean }

export interface Side {
  id: string;
  name: string;
  short: string;
  abbr?: string;
  logo?: string;
  flag?: string;
  country?: string;
  color?: string;
  altColor?: string;
  score: number | null;
  form?: string;
  record?: string;
  winner?: boolean;
  sets?: SetScore[];
  seed?: number;
  rank?: number;
  rankPoints?: number;
}

export interface MarketProbs { home: number; draw?: number; away: number; overUnder?: number }

export interface MatchItem {
  id: string;
  sport: Sport;
  league: { id: string; name: string; region: string; tier: number; tour?: string; eventId?: string };
  group?: string;
  doubles?: boolean;
  round?: string;
  date: string;
  dateKey: string;
  state: MatchState;
  statusText: string;
  statusDetail?: string;
  clock?: string;
  period?: number;
  home: Side;
  away: Side;
  venue?: string;
  market?: MarketProbs | null;
  name?: string;
  shortName?: string;
  bestOf?: number;
  surface?: string;
  note?: string;
}

export interface MatchListResponse {
  date: string;
  today: string;
  yesterday: string;
  tomorrow: string;
  matches: MatchItem[];
  errors: { league?: string; tour?: string; error: string }[];
}

export interface Insight { kind: 'strength' | 'weakness' | 'warning' | 'info'; text: string; tag?: string }
export interface Factor { key: string; label: string; home: number; away: number; weight: number; note?: string }
export interface Verdict {
  winner: 'home' | 'away' | 'draw'; text: string; sub?: string;
  /** najważniejsze czynniki za typem, np. "forma, punkty na mecz" */
  why?: string;
  /** faworyt wg kursów – tylko do porównania, nie wpływa na prognozę */
  market?: { winner: 'home' | 'away' | 'draw'; p: number; agrees: boolean } | null;
}

// ---- piłka nożna ----
export interface FormGame {
  id: string; date: string; opponent: { id: string; name: string; short: string; logo?: string };
  homeAway: 'H' | 'A'; gf: number; ga: number; result: 'W' | 'D' | 'L'; competition?: string; round?: string;
}
export interface RecordSplit { gp: number; w: number; d: number; l: number; gf: number; ga: number; pts?: number }
export interface TeamRecord { overall: RecordSplit; home: RecordSplit; away: RecordSplit; rank: number | null; streak: number }
export interface TableRow {
  id: string; name: string; short: string; logo?: string; gp: number; w: number; d: number; l: number; gf: number; ga: number; gd: number; pts: number; rank: number; note?: string; noteColor?: string; teams?: number; noGoals?: boolean;
}
export interface PlayerStats {
  goals: number; assists: number; shots: number; shotsOnTarget: number; saves: number; yellow: number; red: number; fouls: number; foulsSuffered: number; passes: number; accuratePasses: number; tackles: number; goalsConceded: number; ownGoals: number; offsides: number;
}
export interface LineupPlayer {
  id: string; name: string; short: string; jersey: string; position: string; positionPl: string; positionName?: string; starter: boolean; formationPlace: number; subbedIn: boolean; subbedOut: boolean; stats: PlayerStats; impact?: number; why?: string;
}
export interface Lineup { formation: string | null; starters: LineupPlayer[]; subs: LineupPlayer[] }
export interface AbsenceInfo { matches: number; regulars: number; missingCount: number; missing: { name: string; pos: string; starts: number; of: number; onBench: boolean }[] }
export interface MatchEvent { kind: string; minute: string; minuteNum: number; team: 'home' | 'away' | 'none'; players: string[]; text: string; typeText: string }
export interface StatRow { key: string; label: string; home: number; away: number; pctType: boolean }
export interface H2HGame { id: string; date: string; home: { id: string; name: string; short: string; logo?: string; score: number }; away: { id: string; name: string; short: string; logo?: string; score: number } }

export interface TeamDetail extends Omit<Side, 'record'> {
  lastFive: FormGame[];
  record: TeamRecord | null;
  table: TableRow | null;
  squad: { size: number; avgAge: number | null; byPos: Record<string, number> } | null;
  formation?: string | null;
}

export interface FootballRatings { atak: number; obrona: number; forma: number; boisko: number; bilans: number; stabilnosc: number }

export interface FootballAnalysis {
  probs: { home: number; draw: number; away: number };
  model: { home: number; draw: number; away: number };
  live: { home: number; draw: number; away: number; over25: number; btts: number; topScores: { score: string; p: number }[]; xgRemaining: { home: number; away: number }; minute: number; remainingMinutes: number } | null;
  market: { home: number; draw: number; away: number } | null;
  xg: { home: number; away: number };
  leagueAvgGoals: number;
  over25: number;
  btts: number;
  topScores: { score: string; p: number }[];
  scoreMatrix: number[][] | null;
  confidence: number;
  verdict: Verdict;
  factors: Factor[];
  insights: { home: Insight[]; away: Insight[]; match: Insight[] };
  ratings: { home: FootballRatings; away: FootballRatings };
  keyPlayers: { home: LineupPlayer[]; away: LineupPlayer[] };
  momentum: { home: number; away: number } | null;
  newsAdj?: { home: number; away: number };
  strengths: { home: { attack: number; defense: number; ppg: number; form: number }; away: { attack: number; defense: number; ppg: number; form: number } };
  basis?: 'analysis';
  params?: { source: 'default' | 'fitted'; elo: number; xg: number; form: number; homeAtt: number };
  elo?: { home: number; away: number; diff: number; p: number; n: { home: number; away: number } } | null;
  xgData?: { home: { xgFor: number; xgAgainst: number; gp: number }; away: { xgFor: number; xgAgainst: number; gp: number } } | null;
  h2hScore?: number;
  context?: {
    home: { restDays: number | null; matches14: number; stakes: number; venueAttack: number; venueDefense: number; attackRecent: number; defenseRecent: number };
    away: { restDays: number | null; matches14: number; stakes: number; venueAttack: number; venueDefense: number; attackRecent: number; defenseRecent: number };
  };
}

export interface FootballDetail {
  summary: MatchItem;
  teams: { home: TeamDetail; away: TeamDetail };
  stats: StatRow[];
  events: MatchEvent[];
  lineups: { home: Lineup | null; away: Lineup | null };
  absences?: { home: AbsenceInfo | null; away: AbsenceInfo | null } | null;
  news: { home: NewsHeadline[]; away: NewsHeadline[]; signal: { home: { neg: number; pos: number }; away: { neg: number; pos: number } } } | null;
  standings: TableRow[];
  standingsNote?: string;
  h2h: { games: H2HGame[]; summary: { homeWins: number; awayWins: number; draws: number; homeGoals: number; awayGoals: number; total: number } | null };
  venue?: string;
  city?: string;
  referee?: string;
  attendance?: number;
  analysis: FootballAnalysis;
  fetchedAt: string;
}

// ---- kupony (symulacja) ----
export interface NewsHeadline { title: string; link: string; date: string | null; source: string; tone: 'neg' | 'pos' | 'neutral' }
export interface PickNews { neg: number; pos: number; top: { title: string; tone: 'neg' | 'pos'; source: string; link: string }[] }
export interface BetPick {
  matchId: string; leagueId: string; leagueName: string; kickoff: string; home: string; away: string; homeLogo?: string; awayLogo?: string;
  sel: 'home' | 'draw' | 'away'; selLabel: string; odds: number; pModel: number; pMarket: number; pEst: number; ev: number; confidence: number; why: string;
  modelWeight?: number; games?: number; mode?: 'analysis' | 'value';
  news?: { home: PickNews; away: PickNews } | null;
  status: 'open' | 'won' | 'lost' | 'void'; result?: string | null;
}
export interface Coupon {
  id: string; createdAt: string; date: string; type: 'solo' | 'ako2' | 'ako3'; picks: BetPick[]; stake: number; totalOdds: number; potentialWin: number; pEst: number; ev: number;
  status: 'open' | 'won' | 'lost' | 'void'; payout: number; settledAt?: string;
}
export interface BetSettings {
  auto: boolean; autoHour: number; maxCouponsPerDay: number; stakePct: number; mode: 'analysis' | 'value'; minProb: number; minEdge: number; modelWeight: number; minOdds: number; maxOdds: number; minConfidence: number; maxTier: number; horizonHours: number;
}
export interface BetsState {
  bankroll: number; startBankroll: number; settings: BetSettings;
  stats: { profit: number; roi: number; staked: number; returned: number; openStake: number; won: number; lost: number; void: number; open: number; hitRate: number; streak: number; bestWin: number };
  coupons: Coupon[]; history: { t: string; bankroll: number; note?: string }[]; lastGeneratedDate: string | null; lastSettledAt: string | null; today: string;
}

// ---- skuteczność modelu ----
export interface MetricSet { n: number; accuracy: number; logloss: number; brier: number }
export interface CalibrationRow { range: string; n: number; predicted: number; actual: number }
export interface SummaryBlock {
  model: MetricSet; modelWithMarket: MetricSet; market: MetricSet;
  disagree: { n: number; modelAccuracy: number; marketAccuracy: number }; agree: { n: number; accuracy: number };
  calibration: CalibrationRow[]; byOutcome: Record<'home' | 'draw' | 'away', { n: number; predicted: number; hit: number; precision: number }>;
  perLeague: { league: string; name: string; model: MetricSet; market: MetricSet }[];
}
export interface TrackedPrediction {
  matchId: string; leagueId: string; leagueName: string; date: string; home: string; away: string; homeLogo?: string; awayLogo?: string;
  probs: { home: number; draw: number; away: number }; fav: 'home' | 'draw' | 'away'; confidence?: number; market?: { home: number; draw: number; away: number } | null;
  result?: 'home' | 'draw' | 'away'; score?: string; hit?: boolean; why?: string;
}
export interface BacktestPublic {
  fittedAt: string; params: Record<string, number>;
  test: { n: number; model: MetricSet; defaultParams: MetricSet; withoutElo: { accuracy: number; logloss: number }; withoutXg: { accuracy: number; logloss: number }; market: MetricSet; modelWithMarket: MetricSet; disagree: SummaryBlock['disagree']; agree: SummaryBlock['agree']; calibration: CalibrationRow[]; byOutcome: SummaryBlock['byOutcome']; perLeague: SummaryBlock['perLeague'] };
  all: { n: number; model: MetricSet; market: MetricSet; modelWithMarket: MetricSet; calibration: CalibrationRow[]; perLeague: SummaryBlock['perLeague'] };
  train: { n: number; logloss: number; from?: string; to?: string };
  xg: { coef: { sot: number; other: number; corners: number }; n: number; corr: number | null; teams: number };
  tennis: { n: number; accuracyAll: number; accuracySurface: number; days: number };
  history: { footballMatches: number; tennisMatches: number; leagues: number; seasons?: Record<string, number>; splitDate?: string };
}
export interface AccuracyRemote {
  generatedAt: string;
  tracked: { all: SummaryBlock; last30: SummaryBlock; pending: number; settled: number; daily: { date: string; n: number; hit: number; marketHit: number; withMarket: number }[] } | null;
  upcoming: TrackedPrediction[]; recent: TrackedPrediction[]; backtest: BacktestPublic;
}
export interface MyTracker {
  n: number; pending: number; accuracy: number; brier: number; marketN: number; marketAccuracy: number;
  disagree: { n: number; modelAccuracy: number; marketAccuracy: number }; items: TrackedPrediction[];
}
export interface AccuracyResponse { remote: AccuracyRemote | null; mine: MyTracker; ratings: { generatedAt: string; teams: number; xgTeams: number; tennisPlayers: number } | null; today: string }
export interface EloResponse {
  generatedAt: string | null;
  leagues: { slug: string; name: string; region: string; tier: number; mean: number | null; teams: { id: string; name: string; elo: number; n: number; xg: { gp: number; xgFor: number; xgAgainst: number } | null }[] }[];
  tennis: { atp: TennisEloRow[]; wta: TennisEloRow[] };
}
export interface TennisEloRow { id: string; name: string; tour: string; all: number; hard: number; clay: number; grass: number; n: number; nHard: number; nClay: number; nGrass: number }

// ---- tenis ----
export interface TennisResult {
  id: string; date: string; tournament?: string; round?: string; opponent: { id: string; name: string; rank?: number; seed?: number }; won: boolean; score: string; setsWon?: number; setsLost?: number; surface?: string; retired?: boolean;
}
export interface TennisPlayer extends Side {
  rankPrev: number | null; rankTrend: string | null; age: number | null; height: string | null; heightCm: number | null; weightKg: number | null; hand: string | null; birthPlace: string | null; debutYear: number | null;
  career: { won: number; lost: number; titles: number; prize: number };
  recent: TennisResult[];
  tournamentRun: TennisResult[];
}
export interface TennisRatings { ranking: number; forma: number; skutecznosc: number; doswiadczenie: number; turniej: number; nawierzchnia: number; tytuly: number }
export interface TennisAnalysis {
  probs: { home: number; away: number };
  pre: { home: number; away: number };
  live: { home: number; away: number; setWinNow: number | null } | null;
  pointWin: { home: number; away: number };
  state: { setsHome: number; setsAway: number; gamesHome: number; gamesAway: number; bestOf: number; setsToWin: number; inTiebreak: boolean; tbHome: number; tbAway: number };
  paths: { label: string; winner: 'home' | 'away'; p: number }[];
  confidence: number;
  verdict: Verdict;
  factors: Factor[];
  insights: { home: Insight[]; away: Insight[]; match: Insight[] };
  ratings: { home: TennisRatings; away: TennisRatings };
  h2h: { homeWins: number; awayWins: number; games: (TennisResult & { winner: 'home' | 'away' })[] };
  form: { home: { score: number; n: number; wins: number; setsLostPerMatch: number | null }; away: { score: number; n: number; wins: number; setsLostPerMatch: number | null } };
  surface: { home: { won: number; lost: number; n: number }; away: { won: number; lost: number; n: number } };
  components: { rank: number; elo?: number | null; base?: number; form: number; surface: number; h2h: number };
  elo?: { home: number; away: number; surface: boolean; homeAll: number; awayAll: number; homeSurf: number; awaySurf: number; homeN: number; awayN: number } | null;
}
export interface TennisDetail {
  summary: MatchItem;
  players: { home: TennisPlayer; away: TennisPlayer };
  tournament: { name: string; surface: string; surfacePl: string; category: string; round?: string; court?: string; bestOf: number; group?: string };
  analysis: TennisAnalysis;
  fetchedAt: string;
}

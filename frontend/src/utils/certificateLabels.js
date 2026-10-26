const TIER_LABELS = {
  completion: 'Completion',
  excellence: 'Excellence',
  distinction: 'Distinction',
  champion: 'Champion',
  runner_up: 'Runner-Up',
  finalist: 'Finalist',
};

const CONTEST_RANKS = {
  champion: 1,
  runner_up: 2,
  finalist: 3,
};

function ordinal(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) return '';
  const mod100 = number % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${number}th`;
  switch (number % 10) {
    case 1: return `${number}st`;
    case 2: return `${number}nd`;
    case 3: return `${number}rd`;
    default: return `${number}th`;
  }
}

function topRank(tier) {
  const match = /^top_(\d+)$/.exec(String(tier || ''));
  return match ? Number(match[1]) : null;
}

export function certificateTierLabel(tier) {
  const value = String(tier || '').trim();
  if (!value) return '';
  if (TIER_LABELS[value]) return TIER_LABELS[value];
  const rank = topRank(value);
  if (rank) return `${ordinal(rank)} Place`;
  const readable = value.replace(/_/g, ' ');
  return readable.charAt(0).toUpperCase() + readable.slice(1);
}

export function contestPlacementLabel(tier) {
  const value = String(tier || '').trim();
  const rank = CONTEST_RANKS[value] || topRank(value);
  return rank ? `${ordinal(rank)} Place` : certificateTierLabel(value);
}

export function contestRankLabel(tier) {
  const value = String(tier || '').trim();
  const rank = CONTEST_RANKS[value] || topRank(value);
  return rank ? `#${rank}` : '–';
}

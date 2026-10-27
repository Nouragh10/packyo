export interface AccommodationBallot {
  members?: Record<string, unknown>;
  accommodationSuggestions?: Array<{ id: string; name: string; [key: string]: unknown }>;
  accommodationVotes?: Record<string, Record<string, string>>;
  accommodationLockedBy?: Record<string, boolean>;
}
export function accommodationRanking(trip: AccommodationBallot) {
  const memberIds = Object.keys(trip.members ?? {}).sort();
  const options = trip.accommodationSuggestions ?? [];
  const scores = options.map((_, index) => memberIds.reduce((score, uid) => {
    const vote = trip.accommodationVotes?.[index]?.[uid];
    return score + (vote === "up" ? 1 : vote === "down" ? -1 : 0);
  }, 0));
  const topScore = Math.max(...scores);
  const tiedIndices = scores.flatMap((score, index) => score === topScore ? [index] : []);
  const locked = memberIds.filter(uid => trip.accommodationLockedBy?.[uid] === true);
  const hasQuorum = memberIds.length > 0 && locked.length >= Math.max(1, Math.ceil(memberIds.length / 2));
  const ballotKey = JSON.stringify({
    options,
    votes: options.map((_, index) => memberIds.map(uid => [uid, trip.accommodationVotes?.[index]?.[uid] ?? null])),
    locked,
  });
  return { scores, topScore, tiedIndices, hasQuorum, ballotKey };
}

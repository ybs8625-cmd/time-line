export const OUTRO_SECONDS = 1.5;
export const OUTRO_TRANSITION_SECONDS = 1.0;

export function totalDurationSeconds(journeyDurationSeconds) {
  return Math.max(1, journeyDurationSeconds) + OUTRO_SECONDS;
}

export function frameAtElapsedSeconds(elapsedSeconds, journeyDurationSeconds) {
  const journeySeconds = Math.max(1, journeyDurationSeconds);
  if (elapsedSeconds <= journeySeconds) {
    return {
      journeyProgress: Math.min(1, Math.max(0, elapsedSeconds / journeySeconds)),
      outroProgress: 0,
    };
  }
  return {
    journeyProgress: 1,
    outroProgress: Math.min(1, Math.max(0, (elapsedSeconds - journeySeconds) / OUTRO_TRANSITION_SECONDS)),
  };
}

export function frameAtOverallProgress(overallProgress, journeyDurationSeconds) {
  const elapsed = Math.min(1, Math.max(0, overallProgress)) * totalDurationSeconds(journeyDurationSeconds);
  return frameAtElapsedSeconds(elapsed, journeyDurationSeconds);
}

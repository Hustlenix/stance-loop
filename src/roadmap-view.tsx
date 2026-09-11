import type { CalisthenicsLevel } from "./curriculum/calisthenics";
import {
  getExerciseById,
  getExercisesByLevel,
  getLevelName,
  isExerciseUnlocked,
} from "./curriculum/calisthenics";
import type { RoadmapConfig, RoadmapProgress, RoadmapSession } from "./roadmap";
import { formatDuration, getOverallProgressPercent } from "./roadmap";

export const ROADMAP_LEVELS: CalisthenicsLevel[] = [0, 1, 2, 3, 4, 5, 6];

interface RoadmapViewProps {
  config: RoadmapConfig;
  progress: RoadmapProgress;
  session: RoadmapSession | null;
  confirmArmed: boolean;
  effectiveLevel: CalisthenicsLevel;
  nextExercise: string | null;
  onGenerate: () => void;
  onRegenerate: () => void;
  onArmConfirm: () => void;
  onCompleteSession: () => void;
  onUpdateLevel: (level: CalisthenicsLevel) => void;
}

export default function RoadmapView({
  config,
  progress,
  session,
  confirmArmed,
  effectiveLevel,
  nextExercise,
  onGenerate,
  onRegenerate,
  onArmConfirm,
  onCompleteSession,
  onUpdateLevel,
}: RoadmapViewProps) {
  const percent = getOverallProgressPercent(progress);

  return (
    <main className="page library-page" data-testid="roadmap-page">
      <section className="section-block">
        <span className="kicker">PROGRESSIVE CALISTHENICS</span>
        <h1>Build the pyramid.</h1>
        <p>
          Progress here is self-reported — camera coaching covers pushup, handstand and jab-cross.
        </p>

        {effectiveLevel > config.currentLevel && (
          <p data-testid="roadmap-auto-advanced">
            Auto-advanced — {getLevelName(effectiveLevel)} unlocked.
          </p>
        )}

        <div className="roadmap-stats">
          <div className="roadmap-stat">ALL-TIME {percent}%</div>
          <div className="roadmap-stat">SESSIONS {progress.sessionsCompleted}</div>
          <div className="roadmap-stat">
            STREAK {progress.currentStreak} {progress.currentStreak === 1 ? "day" : "days"}
          </div>
          <div className="roadmap-stat">TOTAL {formatDuration(progress.totalWorkoutMinutes)}</div>
        </div>

        <div
          className="distance-bar"
          data-testid="roadmap-progress-bar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <i style={{ width: `${percent}%` }} />
        </div>

        {session ? (
          <div className="roadmap-session" data-testid="roadmap-session">
            <span className="kicker">{config.mode.toUpperCase()}</span>
            <h2>{session.name}</h2>
            <p>{session.description}</p>

            {session.warmup.length > 0 && (
              <div className="workout-steps">
                <span>Warmup</span>
                {session.warmup.map((exercise) => (
                  <span key={`warmup-${exercise.exerciseId}`}>
                    {getExerciseById(exercise.exerciseId)?.name ?? exercise.exerciseId}
                  </span>
                ))}
              </div>
            )}

            {session.exercises.length > 0 && (
              <div className="workout-steps">
                {session.exercises.map((exercise) => {
                  const name = getExerciseById(exercise.exerciseId)?.name ?? exercise.exerciseId;
                  const detail =
                    exercise.targetReps !== undefined
                      ? `${exercise.targetReps} reps`
                      : exercise.targetHoldSeconds !== undefined
                        ? `${exercise.targetHoldSeconds}s hold`
                        : `${exercise.sets} sets`;
                  return (
                    <span key={`main-${exercise.exerciseId}`}>
                      {name} · {detail}
                    </span>
                  );
                })}
              </div>
            )}

            {session.cooldown.length > 0 && (
              <div className="workout-steps">
                <span>Cooldown</span>
                {session.cooldown.map((exercise) => (
                  <span key={`cooldown-${exercise.exerciseId}`}>
                    {getExerciseById(exercise.exerciseId)?.name ?? exercise.exerciseId}
                  </span>
                ))}
              </div>
            )}

            {session.exercises.length === 0 && (
              <p>Level complete — pick a new focus.</p>
            )}

            {confirmArmed && (
              <p data-testid="roadmap-confirm-note">
                This banks {session.exercises.length}{" "}
                {session.exercises.length === 1 ? "move" : "moves"}.
              </p>
            )}

            <div className="roadmap-actions">
              <button className="subtle-button" onClick={onRegenerate}>
                New session
              </button>
              <button
                className={confirmArmed ? "primary" : "outline"}
                onClick={() => (confirmArmed ? onCompleteSession() : onArmConfirm())}
                data-testid="roadmap-complete-session"
              >
                {confirmArmed ? "Confirm — everything above is done?" : "Complete session"}
              </button>
            </div>
          </div>
        ) : (
          <button
            className="primary"
            onClick={onGenerate}
            data-testid="roadmap-launcher"
          >
            Generate next session →
          </button>
        )}
      </section>

      <section className="section-block">
        <div className="library-filters roadmap-level-picker">
          <label>
            PREFERRED LEVEL
            <select
              data-testid="roadmap-level-select"
              value={config.currentLevel}
              onChange={(event) => onUpdateLevel(Number(event.target.value) as CalisthenicsLevel)}
            >
              {ROADMAP_LEVELS.map((level) => (
                <option key={level} value={level}>
                  Level {level + 1} · {getLevelName(level)}
                </option>
              ))}
            </select>
          </label>
        </div>

        {nextExercise !== null ? (
          <p data-testid="roadmap-next-up">
            Next up: <b>{nextExercise}</b> — {getLevelName(progress.currentLevel)}.
          </p>
        ) : (
          <p data-testid="roadmap-next-up">Pyramid complete — every level mastered.</p>
        )}

        {ROADMAP_LEVELS.map((level) => {
          const stored = progress.levelProgress[level];
          const levelExercises = getExercisesByLevel(level);
          const completed = stored?.completed ?? 0;
          const total = stored?.total ?? levelExercises.length;
          return (
            <div key={level} className="section-block roadmap-level-block">
              <div className="roadmap-level-head">
                <h3 className="roadmap-level-title">
                  LEVEL {level + 1}
                </h3>
                <span className="kicker">
                  {completed} / {total} mastered
                </span>
              </div>
              <p>{getLevelName(level)}</p>
              <div className="workout-steps roadmap-level-exercises">
                {levelExercises.map((exercise) => {
                  const done = progress.completedExercises.has(exercise.id);
                  const unlocked = isExerciseUnlocked(exercise.id, progress.completedExercises);
                  return (
                    <span
                      key={exercise.id}
                      data-testid={`roadmap-exercise-${exercise.id}`}
                      className={
                        [done && "done", unlocked && "current", !unlocked && "roadmap-locked"]
                          .filter(Boolean)
                          .join(" ") || undefined
                      }
                      title={unlocked ? undefined : "Locked — master the prerequisites first"}
                    >
                      {exercise.name}
                    </span>
                  );
                })}
              </div>
            </div>
          );
        })}
      </section>
    </main>
  );
}
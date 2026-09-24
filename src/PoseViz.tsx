import { poseConnections } from "./poseEngine";
import type { Point } from "./types";

type Props = {
  landmarks?: Point[];
  className?: string;
  offsetX?: number;
  scaleX?: number;
  label?: string;
  minVisibility?: number;
};

export default function PoseViz({
  landmarks,
  className = "",
  offsetX = 0,
  scaleX = 1,
  label,
  minVisibility = 0.25,
}: Props) {
  if (!landmarks?.length) return <div className={`pose-viz-empty ${className}`}>No pose frame</div>;
  const x = (point: Point) => (offsetX + point.x * scaleX) * 1000;
  const y = (point: Point) => point.y * 600;
  return (
    <svg className={`pose-viz ${className}`} viewBox="0 0 1000 600" role="img" aria-label={label ?? "Pose skeleton"}>
      {poseConnections.map(([start, end]) => {
        const a = landmarks[start];
        const b = landmarks[end];
        if (!a || !b || (a.visibility ?? 1) < minVisibility || (b.visibility ?? 1) < minVisibility) return null;
        return <line key={`${start}-${end}`} x1={x(a)} y1={y(a)} x2={x(b)} y2={y(b)} />;
      })}
      {landmarks.map((point, index) => (point.visibility ?? 1) >= minVisibility
        ? <circle key={index} cx={x(point)} cy={y(point)} r="6" />
        : null)}
    </svg>
  );
}

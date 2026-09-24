import type { DrillId } from "./types";
import type { CompanionState } from "./companionEngine";

type P = { x: number; y: number };

type Rig = {
  head: P;
  shoulder: P;
  hip: P;
  leftHand: P;
  rightHand: P;
  leftFoot: P;
  rightFoot: P;
};

function rigFor(drillId: DrillId, phase: string): Rig {
  const p = phase.toLowerCase();
  if (drillId === "pushup") {
    const low = p.includes("bottom") || p.includes("descend");
    const y = low ? 47 : 38;
    return {
      head: { x: 16, y: y - 5 },
      shoulder: { x: 27, y },
      hip: { x: 49, y: y + 2 },
      leftHand: { x: 27, y: low ? 65 : 59 },
      rightHand: { x: 35, y: low ? 65 : 59 },
      leftFoot: { x: 70, y: y + 7 },
      rightFoot: { x: 73, y: y + 3 },
    };
  }
  if (drillId === "handstand") {
    const entering = p.includes("enter") || p.includes("setup") || p.includes("set-up");
    return entering
      ? {
          head: { x: 34, y: 52 }, shoulder: { x: 39, y: 45 }, hip: { x: 49, y: 31 },
          leftHand: { x: 29, y: 70 }, rightHand: { x: 43, y: 70 },
          leftFoot: { x: 61, y: 13 }, rightFoot: { x: 70, y: 18 },
        }
      : {
          head: { x: 40, y: 54 }, shoulder: { x: 40, y: 45 }, hip: { x: 40, y: 28 },
          leftHand: { x: 31, y: 71 }, rightHand: { x: 49, y: 71 },
          leftFoot: { x: 35, y: 7 }, rightFoot: { x: 45, y: 7 },
        };
  }
  const cross = p.includes("cross");
  const jab = p.includes("jab") || p.includes("extend");
  return {
    head: { x: 40, y: 15 },
    shoulder: { x: 40, y: 29 },
    hip: { x: 42, y: 49 },
    leftHand: { x: jab && !cross ? 12 : 28, y: jab && !cross ? 28 : 25 },
    rightHand: { x: cross ? 69 : 52, y: cross ? 29 : 25 },
    leftFoot: { x: 29, y: 72 },
    rightFoot: { x: 57, y: 72 },
  };
}

export default function CompanionAvatar({ drillId, phase, state }: { drillId: DrillId; phase: string; state: CompanionState }) {
  const rig = rigFor(drillId, phase);
  const stroke = state === "correcting" || state === "tracking-lost" ? "currentColor" : "currentColor";
  return <svg className={`companion-avatar avatar-${drillId} avatar-state-${state}`} viewBox="0 0 80 80" aria-hidden="true">
    <circle className="avatar-head" cx={rig.head.x} cy={rig.head.y} r="6" />
    <g className="avatar-body" stroke={stroke}>
      <line x1={rig.shoulder.x} y1={rig.shoulder.y} x2={rig.hip.x} y2={rig.hip.y} />
      <line x1={rig.shoulder.x} y1={rig.shoulder.y} x2={rig.leftHand.x} y2={rig.leftHand.y} />
      <line x1={rig.shoulder.x} y1={rig.shoulder.y} x2={rig.rightHand.x} y2={rig.rightHand.y} />
      <line x1={rig.hip.x} y1={rig.hip.y} x2={rig.leftFoot.x} y2={rig.leftFoot.y} />
      <line x1={rig.hip.x} y1={rig.hip.y} x2={rig.rightFoot.x} y2={rig.rightFoot.y} />
    </g>
    <circle className="avatar-joint" cx={rig.shoulder.x} cy={rig.shoulder.y} r="2.5" />
    <circle className="avatar-joint" cx={rig.hip.x} cy={rig.hip.y} r="2.5" />
  </svg>;
}

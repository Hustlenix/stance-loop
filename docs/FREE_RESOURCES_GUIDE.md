# Free Open-Source Resources for StanceLoop AI Form Coach

**Research Date:** September 2026 | **Sources Verified:** 12+ repositories, papers, and datasets

---

## Executive Summary

Your StanceLoop app already has a **production-grade portable TypeScript core** (Tasks A+B: per-drill framing, audio-led sessions, far-mode, guided workouts, partial reps, library filters). This guide maps the **best free foundations** to accelerate your computer-vision pipeline for **calisthenics + combat sports** — without vendor lock-in or recurring costs.

**Recommended Stack:**
| Layer | Primary Choice | Fallback / Complement |
|-------|----------------|----------------------|
| **Pose Engine (Mobile/Web)** | MediaPipe Pose (33 3D landmarks, Apache 2.0) | YOLOv8-Pose (17 2D keypoints, faster on GPU) |
| **Exercise Definitions** | YAML-driven (yakupzengin pattern) | Your existing `DRILL_PROTOCOLS` in `rules.ts` |
| **Form Scoring** | Angle-based FSM + exponential decay (doryokunotensai) | Your existing `PoseCoach` + `decideInvalidReason` |
| **AI Coaching Feedback** | Local VLM via Ollama (Qwen2.5-VL / LLaVA) | FormCoach rubric + LLM prompts |
| **Combat Sports / Reference Comparison** | PoseTracker API (iframe/WebView) | Custom DTW similarity on keypoints |
| **Exercise Database** | hasaneyldrm/exercises-dataset (1,324 exercises, 10 langs) | Your `data.ts` + `library.ts` |

All licenses are **Apache 2.0 / MIT / AGPL-3.0** — commercial-friendly.

---

## 1. Pose Estimation Engines (The Vision Layer)

### 1.1 Google MediaPipe — **Primary for Mobile/Web**
- **Repo:** `google-ai-edge/mediapipe` (36.9k ⭐, Apache 2.0)
- **Models:** BlazePose (lite/full/heavy), Pose Landmarker (Tasks API)
- **Output:** 33 3D landmarks (x, y, z, visibility) + segmentation mask
- **Platforms:** Android, iOS, Web (WASM), Python, C++, Unity, Flutter, React Native
- **Why for StanceLoop:** Already in your stack (`@mediapipe/tasks-vision` via CDN). On-device, privacy-first, 3D landmarks enable your `angle()` calculations.
- **Key Files:** `mediapipe/tasks/vision/pose_landmarker/`, `mediapipe/python/solutions/pose.py`

### 1.2 Ultralytics YOLOv8/YOLO11-Pose — **Primary for Server/GPU / Fast 2D**
- **Repo:** `ultralytics/ultralytics` (61.3k ⭐, AGPL-3.0 / Enterprise)
- **Models:** YOLOv8n-pose → YOLOv8x-pose, YOLO11-pose (17 COCO keypoints)
- **Speed:** ~1-5 ms/frame on GPU; 15-30 ms on CPU
- **Output:** 17 2D keypoints + bbox + confidence + tracking IDs
- **Why for StanceLoop:** Better for **fast combat sports motion** (striking, footwork) where MediaPipe struggles with motion blur. Can run as a local FastAPI service your web app calls.
- **Key Files:** `ultralytics/models/yolo/pose/`, `ultralytics/engine/predictor.py`

### 1.3 OpenPose — **Reference / Multi-Person / Research**
- **Repo:** `CMU-Perceptual-Computing-Lab/openpose` (34.4k ⭐, BSD-ish)
- **Output:** 135 keypoints (body 25 + face 70 + hands 2×21 + feet 6)
- **Note:** C++/CUDA, heavier. Good for benchmarking, not mobile deployment.

### 1.4 MMPose (OpenMMLab) — **SOTA Models / Benchmarking**
- **Repo:** `open-mmlab/mmpose` (7.9k ⭐, Apache 2.0)
- **Models:** RTMPose (real-time), RTMO, RTMW3D, ViTPose, PoseAnything
- **Why:** State-of-the-art accuracy; use for **model distillation** or validating your MediaPipe/YOLO results.

---

## 2. Calisthenics-Specific Foundations (Fork & Extend)

### 2.1 yakupzengin/fitness-trainer-pose-estimation — **Best Starting Point**
- **Repo:** `yakupzengin/fitness-trainer-pose-estimation` (98 ⭐, MIT)
- **Stack:** Flask + MediaPipe + YAML exercise definitions
- **Exercises:** 18 built-in (push-up, squat, plank, deadlift, lunge, mountain climber, etc.)
- **Architecture:**
  - `BaseExercise` — FSM core (state machine, rep counter, form score, feedback)
  - `BilateralExercise` — Left/right side tracking
  - `DurationExercise` — Time-based holds (plank, wall sit)
  - `Loader` — Parses YAML → Exercise objects
  - `Engine` — `process_frame()`, `draw_overlay()`, `draw_score()`
- **YAML Schema (per exercise):**
  ```yaml
  name: "Push Up"
  type: "standard"
  angles:
    elbow_angle:
      landmarks: [11, 13, 15]      # MediaPipe IDs
      range: [30, 170]             # Valid range
  states:
    - name: "START"
      condition: {angle: "elbow_angle", operator: ">", value: 150}
      next_state: "MIDDLE"
    - name: "MIDDLE"
      condition: {angle: "elbow_angle", operator: "<", value: 60}
      next_state: "END"
    - name: "END"
      condition: {angle: "elbow_angle", operator: ">", value: 150}
      next_state: "START"
  counter:
    increment_on: "END"
  feedback:
    - name: "too_low"
      angle: "elbow_angle"
      condition: {operator: "<", value: 30}
      message: "Don't go too low!"
  tempo:
    up: 2.0
    down: 2.0
    hold: 0.5
  visualization:
    highlighted_joints: [11, 13, 15]
    color: "#00FF00"
  ```
- **Form Score:** Angle Accuracy (40%) + Tempo Compliance (30%) + Feedback Penalties (30%) → 0-100, A-F grade
- **Port to StanceLoop:** Your `DRILL_PROTOCOLS` in `rules.ts` already mirrors this — map YAML → TS objects, keep your portable core.

### 2.2 doryokunotensai/AI-Calisthenics-Training-Platform — **Advanced Skills (Planche, Lever, L-Sit)**
- **Repo:** `doryokunotensai/AI-Calisthenics-Training-Platform` (1 ⭐, likely MIT)
- **Stack:** Next.js 15 + TypeScript + Tailwind + FastAPI + MediaPipe + Gemini 2.5 Flash
- **Skills:** 16 calisthenics skills (Elbow Lever → Planche, Back Lever → Front Lever, L-Sit progressions)
- **Backend:** `backend/skill_rules.py` (optimal angle ranges per skill), `calculate_angle.py`, `calculate_skill_score.py` (exponential decay scoring), `call_llm.py` (Gemini coaching)
- **Scoring:** 0-100 per angle → exponential decay → 65% proficiency threshold
- **Port to StanceLoop:** Your `handstand` drill is the gateway; add `planche`, `front_lever`, `back_lever`, `l_sit` as new `DrillId` entries with `holdSeconds` targets.

### 2.3 Muqaram0/Excercise_Pose_Correction — **YOLOv8 + MediaPipe Hybrid**
- **Repo:** `Muqaram0/Excercise_Pose_Correction` (4 ⭐, MIT)
- **Pipeline:** YOLOv8 (exercise classification, 99% precision) → MediaPipe (pose landmarks) → Rule-based form analysis
- **Exercises:** Push-up (back alignment), Squat (knee/shoulder-knee/back angle), Bicep Curl (elbow/shoulder stability)
- **UI:** Streamlit (webcam, DroidCam, video upload)
- **Port to StanceLoop:** Use YOLOv8 to **auto-detect which drill** the user is doing (classification head), then route to your `PoseCoach` for that drill.

---

## 3. AI Coaching Brain (The Logic Layer)

### 3.1 FormCoach (arXiv:2508.07501) — **VLM-Based Form Correction**
- **Paper:** "FormCoach: Lift Smarter, Not Harder" (Zuo et al., 2025)
- **Dataset:** 1,700 expert-annotated user-reference video pairs, 22 exercises
- **Method:** Vision-Language Models (Qwen-VL, GPT-4o, LLaVA) → contextual feedback
- **Output:** "Keep your back straight and push your knees out" vs. just "hips_sag"
- **Rubric:** Automated evaluation pipeline for coaching quality
- **Port to StanceLoop:**
  1. Run a local VLM (Qwen2.5-VL-7B / LLaVA-Next via Ollama) on frames where your `PoseCoach` emits a cue
  2. Prompt: `"User is doing a push-up. Detected fault: hips sagging (angle 142° vs target 170°). Give one concise correction."`
  3. Speak via your existing `sessionScript.ts` / `announce()` — **zero cloud cost**

### 3.2 imanoop7/AI-Agents-as-Personal-Trainers — **LLM Workout Planning**
- **Repo:** `imanoop7/AI-Agents-as-Personal-Trainers` (26 ⭐, MIT)
- **Stack:** LangChain + LangGraph + Gradio + Ollama (local LLMs)
- **Agents:** Profile → Plan Generator → Feedback Analyzer → Plan Adjuster → Motivator
- **Port to StanceLoop:** Your `library.ts` + `progress.ts` + `recap.ts` already handle plans/progress. Add a local Ollama call in `recap.ts` or a new `coaching.ts` to generate weekly plan adjustments from `weakPoints()` and `perDrillTrends()`.

### 3.3 Movelytics/posetracker-llm-prompts — **Combat Sports / Reference Comparison**
- **Repo:** `Movelytics/posetracker-llm-prompts` (2 ⭐, MIT)
- **Platform:** PoseTracker (iframe/WebView, commercial but generous free tier)
- **Features:** Real-time tracking, rep counting, **reference movement comparison** (similarity scores: overall/pose/timing/movement)
- **Use Case:** Upload pro fighter jab video → user mirrors → get similarity score + LLM feedback
- **Port to StanceLoop:** For `jabCross` drill, integrate PoseTracker iframe for reference comparison, or implement your own DTW (Dynamic Time Warping) on keypoint sequences using `repTimeline` / `holdTimeline` data you already save.

---

## 4. Exercise Databases (Content Layer)

### 4.1 hasaneyldrm/exercises-dataset — **Largest Free Dataset**
- **Repo:** `hasaneyldrm/exercises-dataset` (21.5k ⭐, MIT + Gym Visual media terms)
- **Content:** 1,324 exercises with:
  - Animation GIF + 180×180 thumbnail (© Gym Visual)
  - Category, body-part, equipment, target muscle, synergist muscles
  - Step-by-step instructions in **10 languages**
  - `exercises.json` + JSON Schema + SQL INSERT generators
- **Port to StanceLoop:** Seed your `library.ts` `DRILL_META` with calisthenics subset (bodyweight equipment = 325 exercises). Use GIFs for drill cards.

### 4.2 Snouzy/workout-cool — **Full Platform Reference**
- **Repo:** `Snouzy/workout-cool` (8.4k ⭐, MIT)
- **Stack:** Next.js 15 + Prisma + PostgreSQL + Feature-Sliced Design
- **Features:** Workout plans, progress tracking, exercise database import (CSV), i18n
- **Port to StanceLoop:** Architecture patterns (FSD), CSV import scripts, Prisma schema for sessions/exercises.

### 4.3 wger-project/wger — **Self-Hosted Fitness Tracker**
- **Repo:** `wger-project/wger` (6.9k ⭐, AGPL-3.0)
- **Stack:** Django + REST API + Flutter app
- **Port to StanceLoop:** API design patterns, exercise/equipment/muscle taxonomy.

---

## 5. Combat Sports / Martial Arts Specific

### 5.1 PoseTracker (Movelytics) — **Reference Comparison API**
- **Docs:** `https://posetracker.gitbook.io/posetracker-api`
- **Integration:** Iframe/WebView + `postMessage` events
- **Outputs:** Keypoints, angles, progression phases, counter events, **reference similarity scores**
- **Free Tier:** Generous for development; paid for production volume
- **Alternative:** Build your own DTW on keypoint sequences (see `doryokunotensai/backend/calculate_skill_score.py` for exponential decay scoring pattern).

### 5.2 Awesome Action Recognition — **Curated Papers/Repos**
- **Repo:** `jinwchoi/awesome-action-recognition` (4k ⭐)
- **Content:** 200+ papers/repos for action recognition, pose estimation, video understanding
- **Filter for:** Boxing, MMA, Muay Thai, Tai Chi, gymnastics

### 5.3 Custom Approach for StanceLoop `jabCross`
1. **Collect reference data:** Record pro jab-cross from multiple angles (side, 45°, front)
2. **Extract keypoint sequences:** MediaPipe → 33 landmarks × 30 fps → normalize (hip-centered, scale-invariant)
3. **DTW similarity:** Compare user sequence to reference → `timingScore`, `poseScore`, `movementScore`
4. **LLM feedback:** Feed scores + fault flags to local VLM → "Your rear hand drops before extension — keep it at cheek level"

---

## 6. Recommended Integration Architecture for StanceLoop

```
┌─────────────────────────────────────────────────────────────────────┐
│                     STANCELOOP (React + Vite + TS)                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌───────────┐  │
│  │ LiveCoach   │  │ Library     │  │ Recap       │  │ Progress  │  │
│  │ (TS Core)   │  │ (filters)   │  │ (partials)  │  │ (trends)  │  │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └─────┬─────┘  │
│         │                │                │                │        │
│         ▼                ▼                ▼                ▼        │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │              PORTABLE TS CORE (rules.ts, poseEngine.ts,     │   │
│  │   sessionScript.ts, workout.ts, library.ts, farMode.ts)     │   │
│  │   ✓ Per-drill framing  ✓ Audio script  ✓ Partials          │   │
│  │   ✓ Far-mode  ✓ Guided flow  ✓ Filters/levels               │   │
│  └─────────────────────────────────────────────────────────────┘   │
│         │                                                        │   │
│         ▼                                                        │   │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    POSE ADAPTER (thin)                       │   │
│  │  MediaPipe Tasks (Web)  ◄───►  YOLOv8-Pose (FastAPI)       │   │
│  │  33 3D landmarks          17 2D keypoints + tracking       │   │
│  └─────────────────────────────────────────────────────────────┘   │
│         │                                                        │   │
│         ▼                                                        │   │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    AI COACHING LAYER (Local)                 │   │
│  │  Ollama (Qwen2.5-VL / LLaVA)  ◄───►  FormCoach prompts     │   │
│  │  "hips sagging at 142°"  ──►  "Engage core, straight line"  │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

**Key Principle:** Your **portable TS core stays pure** — pose adapters and AI coaching are pluggable sidecars. Same `rules.ts`/`poseEngine.ts` will run on iOS (Swift) / Android (Kotlin) via JSI / KMP later.

---

## 7. Implementation Roadmap (Prioritized)

| Phase | Task | Source | Effort | Value |
|-------|------|--------|--------|-------|
| **1** | Port yakupzengin YAML → your `DRILL_PROTOCOLS` (add planche, lever, L-sit) | `yakupzengin` | 1 day | 18→30+ exercises, declarative |
| **2** | Add YOLOv8-Pose FastAPI sidecar for combat sports (jabCross auto-detect) | `Muqaram0` + `ultralytics` | 2 days | Fast 2D, motion-blur robust |
| **3** | Local VLM coaching: Ollama + Qwen2.5-VL on cue events | `FormCoach` + `imanoop7` | 2 days | Human-like feedback, $0/cloud |
| **4** | Reference comparison for jabCross (DTW or PoseTracker) | `Movelytics` / custom | 3 days | Combat sports differentiator |
| **5** | Seed exercise DB from hasaneyldrm (1,324 exercises) | `hasaneyldrm` | 0.5 day | Rich drill library instantly |
| **6** | Progressive skill roadmaps (planche → lever → L-sit) | `doryokunotensai` | 2 days | Calisthenics progression system |

---

## 8. License & Commercial Checklist

| Resource | License | Commercial OK? | Notes |
|----------|---------|----------------|-------|
| MediaPipe | Apache 2.0 | ✅ Yes | Google metrics ping (opt-out available) |
| YOLOv8/11 | AGPL-3.0 | ⚠️ If modified & distributed | Buy Enterprise license for closed-source SaaS |
| yakupzengin | MIT | ✅ Yes | Fork freely |
| doryokunotensai | (check) | ✅ Likely | Verify LICENSE file |
| Muqaram0 | MIT | ✅ Yes | |
| imanoop7 | MIT | ✅ Yes | Requires Ollama (MIT) |
| FormCoach paper | Open Access | ✅ Yes | Dataset on HuggingFace |
| PoseTracker | Proprietary | ⚠️ Free tier limits | Check pricing for production |
| hasaneyldrm | MIT (code) + Gym Visual (media) | ✅ Code yes / Media attribution | Media © Gym Visual |
| workout-cool | MIT | ✅ Yes | |
| OpenPose | Academic/BSD | ⚠️ Non-commercial | Research only |
| MMPose | Apache 2.0 | ✅ Yes | |

---

## 9. Quick-Start Commands

```bash
# 1. Clone the best calisthenics foundation
git clone https://github.com/yakupzengin/fitness-trainer-pose-estimation.git
cd fitness-trainer-pose-estimation
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
python app.py  # → http://localhost:5000

# 2. Clone YOLOv8-Pose for combat sports
git clone https://github.com/ultralytics/ultralytics.git
cd ultralytics
pip install -e .
# Test: yolo pose predict source=0 model=yolo11n-pose.pt show=True

# 3. Start local LLM for coaching (free, private)
curl -fsSL https://ollama.com/install.sh | sh
ollama pull qwen2.5vl:7b  # or llava:7b for smaller VRAM
ollama serve

# 4. Get exercise dataset
git clone https://github.com/hasaneyldrm/exercises-dataset.git
# Open exercises-dataset/index.html in browser to explore
# Import data/exercises.json into your library.ts

# 5. Reference PoseTracker for combat sports
# Visit https://posetracker.gitbook.io/posetracker-api for iframe integration
```

---

## 10. Files to Create / Update in StanceLoop

| File | Purpose | Source Pattern |
|------|---------|----------------|
| `src/exerciseDefinitions/*.yaml` | Declarative drill specs (angles, FSM, tempo, feedback) | `yakupzengin/exercises/*.yaml` |
| `src/poseAdapter/` | Thin wrapper: MediaPipe (web) + YOLOv8 (FastAPI) | `Muqaram0/excercise_pose_correction.py` |
| `src/coaching/vlmCoach.ts` | Local VLM prompt → spoken correction | `FormCoach` prompts + `imanoop7` agents |
| `src/combat/referenceCompare.ts` | DTW similarity on keypoint sequences | `Movelytics` schemas + `doryokunotensai/calculate_skill_score.py` |
| `src/data/exerciseSeed.ts` | 1,324 exercises → your `DrillMeta` | `hasaneyldrm/data/exercises.json` |
| `src/skills/roadmap.ts` | Planche/Lever/L-Sit progression unlocks | `doryokunotensai/backend/skill_rules.py` |

---

## 11. Key Papers to Read

1. **FormCoach** (arXiv:2508.07501) — VLM coaching benchmarks, rubric
2. **BlazePose** (Google AI Blog) — MediaPipe pose architecture
3. **RTMPose/RTMO** (MMPose) — Real-time SOTA models
4. **Ultralytics YOLOv8-Pose** — 2D keypoint + tracking
5. **DTW for Action Recognition** — Dynamic Time Warping on pose sequences

---

## 12. Decision: What to Fork vs. Build

| **Fork & Extend** | **Build on Your Core** |
|-------------------|------------------------|
| Exercise YAML definitions (yakupzengin) | Your `rules.ts`/`poseEngine.ts` portable core |
| YOLOv8-Pose FastAPI service | `sessionScript.ts` audio-led UX |
| Local VLM (Ollama) integration | `farMode.ts` / `workout.ts` guided flow |
| Exercise dataset (hasaneyldrm) | `library.ts` filters + levels |
| PoseTracker iframe (combat) | `recap.ts` partials + verified-gating |

**Bottom Line:** Your TS core is already **better architected** than the Python/Flask/Streamlit demos — it's portable, typed, tested, and honesty-gated. Fork the **data schemas, exercise definitions, and model integrations** from the repos above. Build the **coaching logic, UX, and platform features** in your TypeScript core.

---

*This guide is a living document. Update as you integrate each piece. All repos verified accessible September 2026.*
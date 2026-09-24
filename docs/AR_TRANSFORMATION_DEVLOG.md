# Devlog — Turning StanceLoop into a private AR training partner

## 1. Teaching the coach to understand events

The first AR attempt would have been easy to get wrong: add companion-specific conditions directly inside the webcam loop.

Instead, the existing deterministic pose state was adapted into domain events.

That means a verified rep becomes `REP_VALID`, tracking loss becomes `TRACKING_LOST`, and a new sustained form problem becomes `FORM_ERROR`.

The companion consumes those events. The CV system never calls “celebrate animation.”

## 2. Recording a workout without recording video

The signature technical problem was:

> How can Past-You exist if no workout video is saved?

The solution is a sampled landmark timeline.

Every ~100 ms during an active scored set, StanceLoop can retain processed pose landmarks plus the current exercise state, rep count, confidence and a small form-error list.

The raw camera frame is not part of the data model.

## 3. Reconstructing motion

Sparse samples would look jerky if rendered literally.

Replay therefore interpolates landmark geometry between adjacent samples while preserving the state metadata from the previous sample.

This keeps storage smaller than per-camera-frame recording while still producing a smooth-enough reconstructed skeleton.

## 4. Racing past me

Past-You mode introduced a synchronization problem.

Starting the old timeline immediately when the user presses a button would make the comparison unfair while the new user is still preparing.

The race now calibrates normally, then uses a three-second countdown. At GO, StanceLoop resets the deterministic movement engine and starts both the new quality window and the ghost timeline from the same origin.

## 5. My ghost can drift

The ghost is reconstructed from normalized camera coordinates, not a calibrated 3D room.

If the phone or webcam changes location between sessions, overlay alignment can shift.

Rather than hiding that limitation, StanceLoop exposes overlay, side-by-side and tempo-focused modes and calls the alignment approximate.

## 6. Making the engineering visible

A reviewer can open Motion Debug View to see live FPS, inference duration, confidence, current phase, rep state and recorder-buffer size.

Replay Lab exposes the exact saved landmark structure and allows the recording to be exported or deleted.

## 7. Building a demo that does not require exercise

A reviewer may be at a desk, deny camera permission, or simply not want to do push-ups.

So the AR Demo is a deterministic landmark fixture. It runs the same style of reconstructed pose and companion behavior without human video.

The project can now explain itself before asking the reviewer to perform anything.

## 8. The resulting identity

StanceLoop is no longer “a webcam rep counter with a mascot.”

It is:

> A privacy-first AR fitness companion that reacts to deterministic movement state and lets you train against a reconstructed version of your past self without storing your video.

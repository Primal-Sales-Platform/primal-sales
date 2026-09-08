# media-src

Source stills for the reel cards, kept here so a shoot packet can point at a
file instead of a description.

These are frames, not the assets that ship. The animated versions come from
`scripts/reel/render-card.mjs` in the primal-training-center repo, and the
exact commands live in each video's shoot packet. They are rendered wide
(1920x1080) because both source formats a walkthrough is built from — screen
capture and the AI avatar — are landscape; a vertical cut is a reframe at
export, never a re-render.

Nothing in here is served to a browser. `/media/` is where the finished video
files go.

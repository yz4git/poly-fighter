# Testing

`npm run test:rules` runs the current behavior suite, including combat/input rules, CPU and Rival Circuit behavior, actual skinned geometry, animation timelines and male/female GLB kick poses. `npm test` also builds production output and checks the rendered HTML. Blender asset regeneration is an explicit command, not a prerequisite for testing existing assets.

Tests that only searched implementation source for strings, repeated historical generator metadata, or targeted retired V6/V8 renderers were removed. Tests should exercise an observable result rather than a spelling or an implementation marker.

The core validation workflow owns the behavior, lint, build and HTML checks. The TPS kick sequence workflow checks actual WebGL knee angles, support-foot height, recovery and rapid links and retains screenshots for review. The TPS visual workflow covers full gameplay scenes. Asset-provider and Blender workflows retain their executable generation and promotion gates; removed source-string checks are not called by them.

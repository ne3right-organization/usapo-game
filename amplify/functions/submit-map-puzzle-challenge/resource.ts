import { defineFunction } from "@aws-amplify/backend";

export const submitMapPuzzleChallenge = defineFunction({
  name: "submit-map-puzzle-challenge",
  resourceGroupName: "data",
});

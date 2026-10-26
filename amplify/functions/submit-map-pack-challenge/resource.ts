import { defineFunction } from "@aws-amplify/backend";

export const submitMapPackChallenge = defineFunction({
  name: "submit-map-pack-challenge",
  resourceGroupName: "data",
});

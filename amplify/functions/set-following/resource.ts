import { defineFunction } from "@aws-amplify/backend";

export const setFollowing = defineFunction({
  name: "set-following",
  resourceGroupName: "data",
});

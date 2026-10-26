import { defineFunction } from "@aws-amplify/backend";

export const setNickname = defineFunction({
  name: "set-nickname",
  resourceGroupName: "data",
});

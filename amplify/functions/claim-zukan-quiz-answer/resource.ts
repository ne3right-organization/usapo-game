import { defineFunction } from "@aws-amplify/backend";

export const claimZukanQuizAnswer = defineFunction({
  name: "claim-zukan-quiz-answer",
  resourceGroupName: "data",
});

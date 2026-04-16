import worker from "../../api/worker.js";

export const onRequest: PagesFunction = (context) => {
  return worker.fetch(context.request, context.env, context);
};

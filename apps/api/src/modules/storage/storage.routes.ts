import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth";
import { storageProvider } from "./storage.provider";

// Every existing caller of a *Ref field (driverSelfieRef, packagePhotoRefs,
// podPhotoRef, driver-document fileRef) is free to use any folder name —
// this whitelist just keeps uploaded objects organized/predictable in the
// bucket rather than constraining what a ref is later used for.
const uploadFolderSchema = z.enum(["pickup-selfies", "package-photos", "pod-photos", "driver-documents"]);

const createUploadUrlSchema = z.object({
  folder: uploadFolderSchema,
  contentType: z.string().min(1),
});

export async function storageRoutes(app: FastifyInstance) {
  // POST /v1/uploads/signed-url — any authenticated user can request an
  // upload slot for themselves; nothing here reads or writes any DB row, so
  // there's no object-level access to check yet. The *result* (the ref) only
  // becomes meaningful once it's attached to a real request (e.g.
  // POST /v1/orders/:id/pickup/verify), which already enforces who's allowed
  // to do that.
  app.post("/v1/uploads/signed-url", { preHandler: [requireAuth] }, async (req, reply) => {
    const body = createUploadUrlSchema.parse(req.body);
    const result = await storageProvider.createUploadUrl(body);
    reply.status(201).send(result);
  });
}

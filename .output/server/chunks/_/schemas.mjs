import { z } from 'zod';

const createBriefSchema = z.object({
    clientId: z.string().uuid(),
    title: z.string().optional(),
    description: z.string().optional(),
    objective: z.string().optional(),
    audienceId: z.string().optional(),
    deadlineAt: z.string().datetime().optional(),
    status: z.enum(['draft', 'approved', 'sent', 'published']).optional()
});
z.object({
    id: z.string().uuid().optional(),
    name: z.string().min(1),
    slug: z.string().min(1).regex(/^[a-z0-9-]+$/),
    website: z.string().optional(),
    industry: z.string().optional(),
    settings: z.record(z.any()).optional()
});
z.object({
    id: z.string().uuid().optional(),
    clientId: z.string().uuid(),
    briefId: z.string().uuid().optional(),
    filename: z.string().optional(),
    originalName: z.string().optional(),
    url: z.string().url(),
    type: z.enum(['image', 'document', 'video', 'audio', 'other']).optional(),
    mimeType: z.string().optional(),
    fileSize: z.number().int().positive().optional(),
    meta: z.record(z.any()).optional()
});
const createOrUpdateClientProfileSchema = z.object({
    primaryCommunicationLanguage: z.enum(['Nederlands', 'UK English', 'US English', 'Francais']).optional(),
    objectives: z.record(z.any()),
    audiences: z.record(z.any()),
    tone: z.record(z.any()).optional(),
    specialInstructions: z.record(z.any()).optional(),
    guardrails: z.record(z.any()).optional(),
    platformPrefs: z.record(z.any()).optional(),
    permissions: z.record(z.any()).optional()
});
const updateClientSchema = z.object({
    clientId: z.string().uuid(),
    // Basic client fields
    name: z.string().min(1).optional(),
    slug: z.string().min(1).regex(/^[a-z0-9-]+$/).optional(),
    website: z.string().optional(),
    industry: z.string().optional(),
    settings: z.record(z.any()).optional(),
    // Profile fields
    profile: z.object({
        primaryCommunicationLanguage: z.enum(['Nederlands', 'UK English', 'US English', 'Francais']).optional(),
        objectives: z.record(z.any()).optional(),
        audiences: z.record(z.any()).optional(),
        tone: z.record(z.any()).optional(),
        specialInstructions: z.record(z.any()).optional(),
        guardrails: z.record(z.any()).optional(),
        platformPrefs: z.record(z.any()).optional(),
        permissions: z.record(z.any()).optional()
    }).optional(),
    // Assets management
    assets: z.object({
        add: z.array(z.object({
            url: z.string().url(),
            type: z.string().optional(),
            meta: z.record(z.any()).optional()
        })).optional(),
        delete: z.array(z.string().uuid()).optional()
    }).optional()
});

export { createOrUpdateClientProfileSchema as a, createBriefSchema as c, updateClientSchema as u };
//# sourceMappingURL=schemas.mjs.map

import { z } from 'zod'
import DOMPurify from 'isomorphic-dompurify'

// Validation schemas
export const GenerationRequestSchema = z.object({
  assetPackId: z.string()
    .min(1, 'Asset pack ID is required')
    .max(50, 'Asset pack ID too long')
    .regex(/^[a-zA-Z0-9-_]+$/, 'Asset pack ID contains invalid characters'),
  
  description: z.string()
    .min(1, 'Description is required')
    .max(2000, 'Description too long (max 2000 characters)')
    .transform((val) => DOMPurify.sanitize(val.trim())),
  
  stream: z.boolean().optional(),
  action: z.enum(['generate', 'cancel']).optional(),
  sessionId: z.string().optional(),
  
  // Existing world for editing/modification - allow any object structure to preserve types
  existingWorld: z.record(z.unknown()).optional(),
  
  // Generation constraints - allow any object structure to preserve types
  constraints: z.record(z.unknown()).optional(),
  
  // Additional generation parameters
  size: z.number().min(3).max(20).optional(),
  complexity: z.enum(['simple', 'medium', 'complex']).optional(),
  seed: z.number().optional()
}).passthrough() // Allow additional properties to pass through

export const SaveWorldRequestSchema = z.object({
  world: z.object({
    asset_pack: z.string(),
    tiles: z.array(z.record(z.unknown())), // More specific validation could be added
    addons: z.array(z.record(z.unknown())).optional(), // Include addons array
    metadata: z.object({}).optional(),
    generation_metadata: z.object({}).optional() // Include generation metadata
  }),
  filename: z.string()
    .optional()
    .transform((val) => val ? sanitizeFilename(val) : undefined)
})

// Asset pack whitelist - only allow known safe asset packs
const ALLOWED_ASSET_PACKS = [
  'kaykit-medieval-pack',
  'demo-pack'
] as const

export function validateAssetPackId(assetPackId: string): boolean {
  return (ALLOWED_ASSET_PACKS as readonly string[]).includes(assetPackId)
}

export function sanitizeFilename(filename: string): string {
  return filename
    .replace(/[^a-zA-Z0-9.-]/g, '-')  // Replace special chars with hyphens
    .replace(/\.\./g, '')             // Prevent directory traversal
    .replace(/^\./, '')               // Prevent hidden files
    .replace(/-+/g, '-')              // Collapse multiple hyphens
    .replace(/^-|-$/g, '')            // Remove leading/trailing hyphens
    .substring(0, 100)                // Limit length
    .toLowerCase()
}

export function validateAndSanitizeDescription(description: string): string {
  // Check for potential prompt injection attempts
  const suspiciousPatterns = [
    /ignore\s+(?:previous|above|all)\s+(?:instructions?|prompts?)/i,
    /system\s*:\s*/i,
    /assistant\s*:\s*/i,
    /human\s*:\s*/i,
    /\[INST\]/i,
    /\[\/INST\]/i,
    /<\s*\/?system\s*>/i,
    /jailbreak/i,
    /pretend\s+(?:to\s+be|you\s+are)/i
  ]

  for (const pattern of suspiciousPatterns) {
    if (pattern.test(description)) {
      throw new Error('Description contains potentially malicious content')
    }
  }

  // Sanitize HTML/script content
  let sanitized = DOMPurify.sanitize(description, { 
    ALLOWED_TAGS: [],
    ALLOWED_ATTR: [] 
  })

  // Additional cleanup
  sanitized = sanitized
    .replace(/[<>]/g, '') // Remove any remaining angle brackets
    .replace(/javascript:/gi, '') // Remove javascript: protocols
    .trim()

  return sanitized
}

export function validateSessionId(sessionId: string): boolean {
  // Session IDs should be alphanumeric and reasonable length
  return /^[a-zA-Z0-9]{8,20}$/.test(sessionId)
}

export function validateWorldData(world: unknown): boolean {
  try {
    if (!world || typeof world !== 'object') return false;
    
    const worldObj = world as Record<string, unknown>;
    return !!(
      worldObj.asset_pack &&
      typeof worldObj.asset_pack === 'string' &&
      Array.isArray(worldObj.tiles) &&
      worldObj.tiles.length > 0 &&
      worldObj.tiles.length <= 1000 // Reasonable limit
    )
  } catch {
    return false
  }
}

// Content moderation - basic checks for inappropriate content
export function moderateContent(text: string): { allowed: boolean; reason?: string } {
  const inappropriatePatterns = [
    /\b(?:violence|kill|murder|death|blood)\b/i,
    /\b(?:sexual|adult|nsfw|porn)\b/i,
    /\b(?:drug|cocaine|heroin|meth)\b/i,
    /\b(?:hate|racist|nazi|terrorism)\b/i
  ]

  for (const pattern of inappropriatePatterns) {
    if (pattern.test(text)) {
      return { 
        allowed: false, 
        reason: 'Content contains inappropriate or potentially harmful language' 
      }
    }
  }

  return { allowed: true }
}

export type ValidatedGenerationRequest = z.infer<typeof GenerationRequestSchema>
export type ValidatedSaveWorldRequest = z.infer<typeof SaveWorldRequestSchema>

import { NextRequest, NextResponse } from 'next/server'

// Simple in-memory rate limiter
class SimpleRateLimiter {
  private requests: Map<string, number[]> = new Map()
  private readonly maxRequests: number
  private readonly windowMs: number

  constructor(maxRequests: number = 10, windowMs: number = 60 * 1000) {
    this.maxRequests = maxRequests
    this.windowMs = windowMs
  }

  isAllowed(identifier: string): boolean {
    const now = Date.now()
    const requests = this.requests.get(identifier) || []
    
    // Clean old requests outside the window
    const validRequests = requests.filter(time => now - time < this.windowMs)
    
    if (validRequests.length >= this.maxRequests) {
      return false
    }
    
    // Add current request
    validRequests.push(now)
    this.requests.set(identifier, validRequests)
    
    return true
  }

  cleanup() {
    const now = Date.now()
    for (const [identifier, requests] of this.requests.entries()) {
      const validRequests = requests.filter(time => now - time < this.windowMs)
      if (validRequests.length === 0) {
        this.requests.delete(identifier)
      } else {
        this.requests.set(identifier, validRequests)
      }
    }
  }
}

// Create rate limiters for different endpoints
const generateWorldLimiter = new SimpleRateLimiter(5, 60 * 1000) // 5 requests per minute
const saveWorldLimiter = new SimpleRateLimiter(10, 60 * 1000)    // 10 requests per minute
const generalApiLimiter = new SimpleRateLimiter(30, 60 * 1000)   // 30 requests per minute

// Cleanup old entries every 5 minutes
setInterval(() => {
  generateWorldLimiter.cleanup()
  saveWorldLimiter.cleanup()
  generalApiLimiter.cleanup()
}, 5 * 60 * 1000)

function getClientIdentifier(request: NextRequest): string {
  // Use IP address as identifier
  const forwarded = request.headers.get('x-forwarded-for')
  const ip = forwarded ? forwarded.split(',')[0] : 'unknown'
  return ip
}

export function middleware(request: NextRequest) {
  const response = NextResponse.next()

  // Add security headers to all responses
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('X-XSS-Protection', '1; mode=block')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.headers.set('Content-Security-Policy', 
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-eval' 'unsafe-inline'; " +
    "style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: blob:; " +
    "connect-src 'self'; " +
    "font-src 'self'; " +
    "object-src 'none'; " +
    "base-uri 'self'; " +
    "form-action 'self'"
  )

  // Apply rate limiting to API routes
  if (request.nextUrl.pathname.startsWith('/api/')) {
    const clientId = getClientIdentifier(request)
    let limiter: SimpleRateLimiter
    let endpointName: string

    // Choose appropriate rate limiter based on endpoint
    if (request.nextUrl.pathname === '/api/generate-world') {
      limiter = generateWorldLimiter
      endpointName = 'generate-world'
    } else if (request.nextUrl.pathname === '/api/save-world') {
      limiter = saveWorldLimiter
      endpointName = 'save-world'
    } else {
      limiter = generalApiLimiter
      endpointName = 'general-api'
    }

    if (!limiter.isAllowed(clientId)) {
      console.warn(`Rate limit exceeded for ${endpointName} endpoint by client: ${clientId}`)
      return new NextResponse(
        JSON.stringify({ 
          error: 'Rate limit exceeded. Please try again later.',
          endpoint: endpointName,
          retryAfter: 60
        }), 
        { 
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': '60'
          }
        }
      )
    }
  }

  return response
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public assets
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}

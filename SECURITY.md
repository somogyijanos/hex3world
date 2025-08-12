# Security Documentation

## Overview

This document outlines the security measures implemented in hex3world to ensure safe public deployment.

## Security Features Implemented

### 1. Rate Limiting
- **API Endpoints**: Different rate limits for different endpoints
  - `/api/generate-world`: 5 requests per minute per IP
  - `/api/save-world`: 10 requests per minute per IP
  - Other API endpoints: 30 requests per minute per IP
- **Implementation**: Custom middleware with IP-based tracking
- **Protection**: Prevents API abuse and excessive LLM costs

### 2. Input Validation & Sanitization
- **Schema Validation**: Zod schemas for all API inputs
- **Content Sanitization**: DOMPurify for user descriptions
- **Asset Pack Whitelist**: Only approved asset packs allowed
- **Protection**: Prevents injection attacks and malicious content

### 3. File System Security
- **Path Traversal Protection**: Secure path resolution with validation
- **Filename Sanitization**: Removes dangerous characters and patterns
- **File Size Limits**: 10MB maximum for world files
- **Directory Validation**: Ensures files stay within allowed directories

### 4. Session Management
- **Session Limits**: Configurable maximum concurrent sessions
- **Automatic Cleanup**: Expired sessions removed automatically
- **Client Isolation**: Sessions tied to client IP addresses
- **Timeout Protection**: Sessions expire after configurable time

### 5. Content Moderation
- **Prompt Injection Detection**: Blocks suspicious prompt patterns
- **Content Filtering**: Basic inappropriate content detection
- **Description Limits**: Maximum length restrictions
- **Safety Measures**: Prevents misuse of LLM capabilities

### 6. Security Headers
- **CSP**: Content Security Policy to prevent XSS
- **Frame Protection**: X-Frame-Options to prevent clickjacking
- **Content Type**: X-Content-Type-Options to prevent MIME sniffing
- **XSS Protection**: X-XSS-Protection header

## Environment Configuration

### Development vs Production

**Development** (`env.example`):
- World saving enabled for testing
- Higher session limits
- Longer timeouts
- Detailed logging

**Production** (`env.production.example`):
- World saving disabled by default
- Lower session limits for cost control
- Shorter timeouts
- Stricter security settings

### Critical Environment Variables

```bash
# Security Settings
ENABLE_WORLD_SAVING=false          # Disable in production
MAX_CONCURRENT_SESSIONS=20         # Lower for production
SESSION_TIMEOUT_MS=900000          # 15 minutes
MAX_DESCRIPTION_LENGTH=1000        # Limit input size

# LLM Protection
LLM_MAX_TOKENS=3000               # Lower token limit
LLM_TEMPERATURE=0.7               # Stable output
```

## Deployment Security Checklist

### Before Deployment
- [ ] Set up LLM provider billing alerts
- [ ] Configure API keys with spending limits
- [ ] Review and adjust rate limits
- [ ] Test all security measures
- [ ] Set `ENABLE_WORLD_SAVING=false`
- [ ] Configure production environment variables

### Infrastructure Security
- [ ] Deploy behind CDN (Cloudflare/Vercel)
- [ ] Enable HTTPS only
- [ ] Configure proper DNS settings
- [ ] Set up monitoring and alerting
- [ ] Regular security updates

### Monitoring
- [ ] API usage tracking
- [ ] Error rate monitoring
- [ ] Cost monitoring for LLM usage
- [ ] Security event logging
- [ ] Performance monitoring

## Security Measures by Attack Vector

### Rate Limiting Attacks
- **Protection**: IP-based rate limiting middleware
- **Mitigation**: 429 status codes with retry-after headers
- **Monitoring**: Request counts and patterns

### Injection Attacks
- **Input Validation**: Zod schemas with strict types
- **Content Sanitization**: DOMPurify for HTML/script removal
- **Prompt Injection**: Pattern detection for malicious prompts
- **Asset Validation**: Whitelist of allowed asset packs

### File System Attacks
- **Path Traversal**: Secure path resolution and validation
- **Directory Restriction**: Files must stay in allowed directories
- **Filename Sanitization**: Remove dangerous characters
- **Size Limits**: Prevent disk space exhaustion

### DoS Attacks
- **Rate Limiting**: Prevent request flooding
- **Session Limits**: Prevent memory exhaustion
- **Timeout Management**: Automatic cleanup of resources
- **Resource Monitoring**: Track usage patterns

### Cost-based Attacks
- **Session Limits**: Prevent excessive LLM usage
- **Token Limits**: Restrict response sizes
- **Content Moderation**: Block inappropriate requests
- **Billing Alerts**: Monitor spending patterns

## Incident Response

### Security Event Detection
1. **Rate Limit Violations**: Log and monitor excessive requests
2. **Injection Attempts**: Alert on suspicious content patterns
3. **Path Traversal**: Log and block directory escape attempts
4. **Unusual Usage**: Monitor for abnormal API patterns

### Response Procedures
1. **Immediate**: Block offending IP addresses
2. **Investigation**: Analyze logs and patterns
3. **Mitigation**: Adjust rate limits or security rules
4. **Recovery**: Restore normal operations
5. **Post-Incident**: Update security measures

## Security Updates

### Regular Maintenance
- Update dependencies monthly
- Review security logs weekly
- Monitor cost patterns daily
- Test security measures quarterly

### Version Control
- All security configurations in version control
- Document all security-related changes
- Regular security audits
- Incident response documentation

## Contact

For security issues or questions:
- Review this documentation
- Check environment configuration
- Monitor application logs
- Test security measures before deployment

---

**Last Updated**: December 2024
**Version**: 1.0.0

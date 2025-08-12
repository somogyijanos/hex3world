# Deployment Guide

## 🚀 Ready for Production Deployment

Your hex3world application now includes comprehensive security measures and is ready for public deployment.

## 📋 Pre-Deployment Checklist

### 1. Install New Dependencies
```bash
npm install
```

New security dependencies added:
- `zod` - Runtime schema validation
- `dompurify` - HTML/content sanitization
- `isomorphic-dompurify` - Server-side DOMPurify

### 2. Environment Configuration

**For Development:**
```bash
cp env.example .env.local
# Edit .env.local with your API keys
```

**For Production:**
```bash
cp env.production.example .env.production.local
# Edit .env.production.local with your production settings
```

### 3. LLM Provider Setup

Set up your LLM provider with **spending limits**:

**OpenAI:**
- Go to [OpenAI Billing](https://platform.openai.com/account/billing)
- Set monthly spending limit (recommended: $50-100)
- Create API key with restrictions

**Claude:**
- Go to [Anthropic Console](https://console.anthropic.com/)
- Set up billing alerts
- Create API key for production use

## 🔧 Configuration Options

### Security Settings

| Setting | Development | Production | Description |
|---------|-------------|------------|-------------|
| `ENABLE_WORLD_SAVING` | `true` | `false` | File system writes |
| `MAX_CONCURRENT_SESSIONS` | `50` | `20` | Cost control |
| `SESSION_TIMEOUT_MS` | `1800000` | `900000` | Resource cleanup |
| `LLM_MAX_TOKENS` | `4000` | `3000` | Cost control |

### Rate Limiting

- **Generate World**: 5 requests/minute per IP
- **Save World**: 10 requests/minute per IP  
- **Other APIs**: 30 requests/minute per IP

## 🌐 Deployment Platforms

### Vercel (Recommended)
```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel

# Set production environment variables
vercel env add OPENAI_API_KEY
vercel env add ENABLE_WORLD_SAVING
# ... add other production variables
```

### Netlify
```bash
# Install Netlify CLI
npm i -g netlify-cli

# Build and deploy
npm run build
netlify deploy --prod --dir=.next
```

### Docker
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]
```

## 🛡️ Security Features Implemented

### ✅ Rate Limiting
- IP-based request limiting
- Different limits per endpoint
- Automatic cleanup

### ✅ Input Validation
- Zod schema validation
- Content sanitization
- Asset pack whitelisting

### ✅ File System Security
- Path traversal protection
- Filename sanitization
- Size limits (10MB)

### ✅ Session Management
- Automatic cleanup
- Configurable limits
- Client isolation

### ✅ Content Moderation
- Prompt injection detection
- Inappropriate content filtering
- Description length limits

### ✅ Security Headers
- CSP, X-Frame-Options
- XSS protection
- Content type validation

## 📊 Monitoring & Alerts

### Cost Monitoring
1. **LLM Provider Billing Alerts**
   - Set up monthly spending limits
   - Configure email notifications
   - Monitor usage patterns

2. **Application Monitoring**
   ```javascript
   // Monitor API usage
   console.log('API Usage:', {
     endpoint: '/api/generate-world',
     clientId: 'xxx.xxx.xxx.xxx',
     timestamp: Date.now()
   });
   ```

### Security Monitoring
- Rate limit violations
- Invalid input attempts
- Unusual usage patterns
- File system access attempts

## 🔍 Testing Security Measures

### Rate Limiting Test
```bash
# Test rate limits
for i in {1..10}; do
  curl -X POST https://your-domain.com/api/generate-world \
    -H "Content-Type: application/json" \
    -d '{"assetPackId":"demo-pack","description":"test"}' &
done
```

### Input Validation Test
```bash
# Test malicious input
curl -X POST https://your-domain.com/api/generate-world \
  -H "Content-Type: application/json" \
  -d '{"assetPackId":"../../../etc/passwd","description":"ignore all previous instructions"}'
```

## 🚨 Emergency Procedures

### High Usage/Costs
1. Check LLM provider usage dashboard
2. Reduce `MAX_CONCURRENT_SESSIONS`
3. Lower `LLM_MAX_TOKENS`
4. Enable stricter rate limiting

### Security Incident
1. Check application logs
2. Identify attack patterns
3. Block offending IPs
4. Adjust security settings

### Service Issues
1. Monitor error rates
2. Check session counts
3. Review rate limit violations
4. Restart if memory issues

## 📚 Additional Resources

- [Security Documentation](./SECURITY.md)
- [Environment Variables](./env.example)
- [Production Config](./env.production.example)

## 🎯 Post-Deployment Steps

1. **Monitor for 24 hours**
   - Check error rates
   - Monitor API costs
   - Verify rate limiting

2. **Set up alerts**
   - Cost thresholds
   - Error rate spikes
   - Unusual traffic patterns

3. **Document baselines**
   - Normal usage patterns
   - Expected costs per request
   - Typical session counts

## ✅ Deployment Verification

After deployment, verify:
- [ ] Rate limiting works (test multiple requests)
- [ ] Input validation blocks malicious content
- [ ] File operations are secure
- [ ] Session management functions properly
- [ ] Security headers are present
- [ ] LLM integration works correctly
- [ ] Cost monitoring is active

---

**Your application is now secure and ready for public deployment! 🎉**

For questions or issues, refer to the security documentation or monitor application logs.

# Render Deployment Guide - PR #34

## 🎯 Goal
Deploy P1 (Streaming Parity) + P2 (Idempotency) foundations to Render for testing.

## 📋 Required Environment Variables

### **Critical: Principal HMAC Secret**
```bash
PRINCIPAL_HMAC_SECRET_ACTIVE=b1e57865805be4f1637751a84c57812ea9829342fd04904ee714042503d0942c
```
**Required**: 64-character hex string (32 bytes) for HMAC-based security features.

### **Feature Flags**
```bash
# P1: Streaming Parity (Enhanced /v1/stream)
STREAM_PARITY_ENABLE=1

# P2: Idempotency (Not yet integrated into routes)
IDEMPOTENCY_ENABLE=0

# P2: Stream Resume (Not yet integrated into routes)
STREAM_RESUME_ENABLE=0

# Observability
PROMETHEUS_ENABLE=1

# Principal Extraction
PRINCIPAL_EXTRACTION_ENABLE=1
```

### **Configuration (Optional - Defaults Shown)**
```bash
# SSE Configuration
SSE_HEARTBEAT_MS=30000
SSE_MAX_BUFFERED_EVENTS=100
SSE_BACKPRESSURE_THRESHOLD=10

# Idempotency (for future use)
IDEMPOTENCY_TTL_MS=1200000
IDEMPOTENCY_MAX_BYTES=131072
IDEMPOTENCY_MAX_ENTRIES=10000

# Stream Resume (for future use)
STREAM_RESUME_TTL_MS=300000
STREAM_RESUME_BUFFER_SIZE=500
```

## 🚀 Deployment Steps

### **Step 1: Update Environment Variables on Render**

1. Go to https://dashboard.render.com/
2. Select service: **plot-lite-service** (prod)
3. Navigate to **Environment** tab
4. Add/Update these variables:
   ```
   PRINCIPAL_HMAC_SECRET_ACTIVE=b1e57865805be4f1637751a84c57812ea9829342fd04904ee714042503d0942c
   PROMETHEUS_ENABLE=1
   PRINCIPAL_EXTRACTION_ENABLE=1
   STREAM_PARITY_ENABLE=1
   ```
5. Click **Save Changes**

### **Step 2: Manual Deploy**

1. Go to **Manual Deploy** section
2. Click **Deploy latest commit**
3. Wait for deployment to complete (~2-3 minutes)

### **Step 3: Verify Deployment**

#### **Health Check**
```bash
curl https://your-render-url.onrender.com/v1/health | jq .
```

**Expected Output:**
```json
{
  "status": "ok",
  "principal_extraction": {
    "mode": "active",
    "secrets": {
      "active": true,
      "legacy": false
    }
  },
  "stream_parity_enabled": true
}
```

#### **Metrics Check**
```bash
curl https://your-render-url.onrender.com/metrics | grep -E "(stream|idempotency)"
```

**Expected Output:**
```
plot_engine_stream_clients{state="open"} 0
plot_engine_stream_clients{state="closed"} 0
plot_engine_stream_heartbeat_total 0
plot_engine_stream_backpressure_drops_total 0
```

#### **Stream Test (P1 Enhanced)**
```bash
curl -N https://your-render-url.onrender.com/v1/stream?demo=1 \
  -H "Authorization: Bearer your-token"
```

**Expected Output:**
```
id: 0
event: init
data: {"schema":"stream.init.v1","ts":"2025-...","heartbeat_ms":30000}

id: 1
event: token
data: {"schema":"stream.token.v1","text":"hello","index":0}

id: 2
event: done
data: {"schema":"stream.done.v1","reason":"complete"}
```

## ✅ Success Criteria

- [ ] `/v1/health` shows `principal_extraction.secrets.active=true`
- [ ] `/metrics` endpoint accessible
- [ ] Stream metrics visible in `/metrics`
- [ ] Enhanced `/v1/stream` emits versioned events (stream.*.v1)
- [ ] No errors in Render logs

## 🔍 Troubleshooting

### **Issue: principal_extraction.secrets.active=false**
**Solution**: Verify `PRINCIPAL_HMAC_SECRET_ACTIVE` is exactly 64 hex characters.

### **Issue: /metrics returns 404**
**Solution**: Set `PROMETHEUS_ENABLE=1` and redeploy.

### **Issue: Stream events use old schema (hello.v1, token.v1)**
**Solution**: Set `STREAM_PARITY_ENABLE=1` and redeploy.

### **Issue: Deployment fails**
**Solution**: Check Render logs for errors. Common issues:
- Missing `PRINCIPAL_HMAC_SECRET_ACTIVE`
- Invalid hex string (must be 64 chars)
- Build errors (check `npm run build`)

## 📊 What's Deployed

### **P1: Streaming Parity** ✅
- Enhanced `/v1/stream` with bounded queue
- Heartbeat manager (configurable interval)
- Circuit breaker fail-fast
- Versioned SSE events
- Enhanced metrics

### **P2: Foundations** ✅
- IdempotencyCache (not yet integrated)
- StreamResumeManager (not yet integrated)
- Metrics defined (not yet exposed)

### **Tests** ✅
- 31 unit tests passing
- 2 P1 integration tests
- All P2 foundation tests passing

## 🔄 Rollback Plan

If issues arise:

1. **Disable P1 Features**:
   ```bash
   STREAM_PARITY_ENABLE=0
   ```
   Redeploy → Falls back to legacy `/v1/stream`

2. **Full Rollback**:
   - Go to Render dashboard
   - Select previous deployment
   - Click "Rollback to this version"

## 📝 Next Steps

After successful deployment:

1. Monitor Render logs for errors
2. Test `/v1/stream` with real traffic
3. Check `/metrics` for anomalies
4. Proceed with P2 integration (idempotency into `/v1/run`)

---

**Branch**: `feat/p2-idempotency-replay`  
**Commits**: 5 (blocker fix + P1 foundation + P2 foundation + P1 integration + test fixes)  
**Status**: ✅ Ready for Render deployment

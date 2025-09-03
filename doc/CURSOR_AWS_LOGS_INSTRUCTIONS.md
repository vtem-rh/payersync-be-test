# AWS Log Access Instructions for Cursor

## 🚨 CRITICAL: Non-Truncated AWS Log Access

When troubleshooting AWS services, **NEVER** use basic `aws logs filter-log-events` as it truncates messages. Always use these methods:

### **Method 1: Full Text Output (Recommended)**
```bash
aws logs get-log-events \
  --log-group-name "/aws/lambda/function-name" \
  --log-stream-name "YYYY/MM/DD/[\$LATEST]stream-id" \
  --region us-east-2 \
  --start-from-head \
  --output text
```

### **Method 2: CloudWatch Insights (Most Powerful)**
```bash
# Start query
aws logs start-query \
  --log-group-names "/aws/lambda/function-name" \
  --start-time $(($(date +%s) - 3600))000 \
  --end-time $(date +%s)000 \
  --query-string "fields @timestamp, @message | filter @message like /ERROR/ | sort @timestamp desc" \
  --region us-east-2

# Get results
aws logs get-query-results --query-id <query-id> --region us-east-2
```

### **Method 3: JSON with jq (Scripting)**
```bash
aws logs filter-log-events \
  --log-group-name "/aws/lambda/function-name" \
  --region us-east-2 \
  --start-time $(($(date +%s) - 3600))000 \
  --filter-pattern "ERROR" \
  --output json | jq '.events[] | {timestamp: .timestamp, message: .message}'
```

### **Method 4: Real-time Streaming**
```bash
aws logs tail "/aws/lambda/function-name" --follow --region us-east-2
```

## ⚠️ **What NOT to Do**
❌ `aws logs filter-log-events --log-group-name "/aws/lambda/function" --filter-pattern "ERROR"` (truncates!)
❌ Rely on CloudWatch console (also truncates)

## 🎯 **Quick Commands**

### **Get Latest Stream**
```bash
aws logs describe-log-streams \
  --log-group-name "/aws/lambda/function-name" \
  --region us-east-2 \
  --order-by LastEventTime \
  --descending \
  --max-items 1 \
  --query 'logStreams[0].logStreamName' \
  --output text
```

### **Complete Error Analysis**
```bash
# Get latest stream
STREAM=$(aws logs describe-log-streams \
  --log-group-name "/aws/lambda/function-name" \
  --region us-east-2 \
  --order-by LastEventTime \
  --descending \
  --max-items 1 \
  --query 'logStreams[0].logStreamName' \
  --output text)

# Get full logs
aws logs get-log-events \
  --log-group-name "/aws/lambda/function-name" \
  --log-stream-name "$STREAM" \
  --region us-east-2 \
  --start-from-head \
  --output text
```

## 📝 **For Cursor Instructions**

Add this to your Cursor instructions:

```
## AWS Log Access Best Practices

When working with AWS Lambda or other AWS services, ALWAYS use these methods for non-truncated log access:

1. **Full Log Stream Access**: `aws logs get-log-events --log-group-name "/aws/lambda/function" --log-stream-name "stream" --output text`
2. **CloudWatch Insights**: Use `aws logs start-query` for complex analysis
3. **JSON with jq**: `aws logs filter-log-events --output json | jq` for structured access
4. **Real-time**: `aws logs tail` for live monitoring

NEVER use basic `aws logs filter-log-events` without `--output text` as it truncates messages.

**Key**: Always use `--output text` or CloudWatch Insights to avoid truncation. Basic `filter-log-events` cuts off important error details!
```

---

**Remember**: The key is using `--output text` or CloudWatch Insights to avoid truncation. Basic `filter-log-events` will cut off important error details! 
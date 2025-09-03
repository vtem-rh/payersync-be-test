# AWS Log Access Guide - Non-Truncated Logs

## 🚨 CRITICAL: Always Use These Methods for Full Log Access

When troubleshooting AWS Lambda or other AWS service logs, **NEVER** use basic `aws logs filter-log-events` as it truncates messages. Use these methods instead:

## 📋 **Method 1: AWS CLI with Full Text Output (Recommended)**

```bash
# Get complete log stream with full messages
aws logs get-log-events \
  --log-group-name "/aws/lambda/your-function-name" \
  --log-stream-name "YYYY/MM/DD/[\$LATEST]stream-id" \
  --region us-east-2 \
  --start-from-head \
  --output text

# For recent logs only
aws logs get-log-events \
  --log-group-name "/aws/lambda/your-function-name" \
  --log-stream-name "YYYY/MM/DD/[\$LATEST]stream-id" \
  --region us-east-2 \
  --start-time $(($(date +%s) - 3600))000 \
  --output text
```

## 🔍 **Method 2: CloudWatch Logs Insights (Most Powerful)**

```bash
# Start a query for full log analysis
aws logs start-query \
  --log-group-names "/aws/lambda/your-function-name" \
  --start-time $(($(date +%s) - 3600))000 \
  --end-time $(date +%s)000 \
  --query-string "fields @timestamp, @message | filter @message like /ERROR/ | sort @timestamp desc" \
  --region us-east-2

# Get the query results (use the query-id from above)
aws logs get-query-results --query-id <query-id-from-above> --region us-east-2
```

## 📊 **Method 3: JSON Output with jq (Best for Scripting)**

```bash
# Get structured JSON output with full messages
aws logs filter-log-events \
  --log-group-name "/aws/lambda/your-function-name" \
  --region us-east-2 \
  --start-time $(($(date +%s) - 3600))000 \
  --filter-pattern "ERROR" \
  --output json | jq '.events[] | {timestamp: .timestamp, message: .message}'

# For specific error patterns
aws logs filter-log-events \
  --log-group-name "/aws/lambda/your-function-name" \
  --region us-east-2 \
  --start-time $(($(date +%s) - 3600))000 \
  --filter-pattern "SyntaxError" \
  --output json | jq '.events[] | {timestamp: .timestamp, message: .message}'
```

## 🔄 **Method 4: Real-time Log Streaming**

```bash
# Follow logs in real-time (no truncation)
aws logs tail "/aws/lambda/your-function-name" --follow --region us-east-2

# Follow with specific filter
aws logs tail "/aws/lambda/your-function-name" --follow --filter-pattern "ERROR" --region us-east-2
```

## 🎯 **Quick Troubleshooting Commands**

### **Find Recent Errors**
```bash
aws logs filter-log-events \
  --log-group-name "/aws/lambda/your-function-name" \
  --region us-east-2 \
  --start-time $(($(date +%s) - 600))000 \
  --filter-pattern "ERROR" \
  --query 'events[*].message' \
  --output text
```

### **Get Latest Log Stream**
```bash
aws logs describe-log-streams \
  --log-group-name "/aws/lambda/your-function-name" \
  --region us-east-2 \
  --order-by LastEventTime \
  --descending \
  --max-items 1 \
  --query 'logStreams[0].logStreamName' \
  --output text
```

### **Complete Error Analysis**
```bash
# 1. Get latest stream
STREAM=$(aws logs describe-log-streams \
  --log-group-name "/aws/lambda/your-function-name" \
  --region us-east-2 \
  --order-by LastEventTime \
  --descending \
  --max-items 1 \
  --query 'logStreams[0].logStreamName' \
  --output text)

# 2. Get full logs from that stream
aws logs get-log-events \
  --log-group-name "/aws/lambda/your-function-name" \
  --log-stream-name "$STREAM" \
  --region us-east-2 \
  --start-from-head \
  --output text
```

## ⚠️ **What NOT to Do**

❌ **NEVER use basic filter-log-events without --output text:**
```bash
# This truncates messages!
aws logs filter-log-events --log-group-name "/aws/lambda/function" --filter-pattern "ERROR"
```

❌ **NEVER rely on CloudWatch console for full logs (also truncates)**

## 🎯 **When to Use Each Method**

- **Method 1**: General troubleshooting, need to see full context
- **Method 2**: Complex log analysis, searching across multiple streams
- **Method 3**: Automation, scripting, structured data processing
- **Method 4**: Real-time monitoring, live debugging

## 📝 **Template for Cursor Instructions**

Add this to your Cursor instructions:

```
## AWS Log Access Best Practices

When working with AWS Lambda or other AWS services, ALWAYS use these methods for non-truncated log access:

1. **Full Log Stream Access**: `aws logs get-log-events --log-group-name "/aws/lambda/function" --log-stream-name "stream" --output text`
2. **CloudWatch Insights**: Use `aws logs start-query` for complex analysis
3. **JSON with jq**: `aws logs filter-log-events --output json | jq` for structured access
4. **Real-time**: `aws logs tail` for live monitoring

NEVER use basic `aws logs filter-log-events` without `--output text` as it truncates messages.
```

## 🔧 **Common Patterns**

### **Lambda Function Logs**
```bash
aws logs get-log-events \
  --log-group-name "/aws/lambda/function-name" \
  --log-stream-name "YYYY/MM/DD/[\$LATEST]id" \
  --region us-east-2 \
  --output text
```

### **API Gateway Logs**
```bash
aws logs get-log-events \
  --log-group-name "API-Gateway-Execution-Logs_rest-api-id/stage" \
  --log-stream-name "stream-name" \
  --region us-east-2 \
  --output text
```

### **EventBridge Logs**
```bash
# EventBridge bus logs (non-truncated)
aws logs get-log-events \
  --log-group-name "/aws/events/adyen-webhook-bus-staging-eb" \
  --region us-east-2 \
  --start-from-head \
  --output text

# EventBridge processor logs
aws logs get-log-events \
  --log-group-name "/aws/lambda/payerSyncOnboarder-staging-eb-standard-notification-handler" \
  --region us-east-2 \
  --start-from-head \
  --output text
```

### **SQS Dead Letter Queue Monitoring**
```bash
# Check DLQ message count
aws sqs get-queue-attributes \
  --queue-url "https://sqs.us-east-2.amazonaws.com/794308924679/payerSyncOnboarder-staging-eb-standard-notification-dlq" \
  --attribute-names ApproximateNumberOfMessages \
  --region us-east-2

# Get DLQ attributes
aws sqs get-queue-attributes \
  --queue-url "https://sqs.us-east-2.amazonaws.com/794308924679/payerSyncOnboarder-staging-eb-standard-notification-dlq" \
  --attribute-names All \
  --region us-east-2
```

---

**Remember**: The key is using `--output text` or CloudWatch Insights to avoid truncation. Basic `filter-log-events` will cut off important error details! 
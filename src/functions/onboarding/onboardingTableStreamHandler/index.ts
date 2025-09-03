import { DynamoDBStreamEvent, DynamoDBStreamHandler } from 'aws-lambda';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { captureAWSv3Client } from 'aws-xray-sdk-core';
import * as AWSXRay from 'aws-xray-sdk-core';
import { OnboardingStatus } from '../../shared/types';

// Initialize SNS client with X-Ray tracing
const snsClient = captureAWSv3Client(new SNSClient({}));
const onboardedTopicArn = process.env.ONBOARDED_EVENT_TOPIC_ARN;
const groupStepCompletedTopicArn = process.env.GROUP_STEP_COMPLETED_TOPIC_ARN;

export const handler: DynamoDBStreamHandler = async (event: DynamoDBStreamEvent): Promise<void> => {
  const segment = AWSXRay.getSegment();

  // Create a new subsegment for the entire stream batch
  const streamSegment = segment?.addNewSubsegment('DynamoDBStreamBatch');
  streamSegment?.addAnnotation('BatchSize', event.Records.length);

  try {
    if (!onboardedTopicArn) {
      console.error('ONBOARDED_EVENT_TOPIC_ARN environment variable is not set');
      return;
    }

    if (!groupStepCompletedTopicArn) {
      console.warn('GROUP_STEP_COMPLETED_TOPIC_ARN environment variable is not set, group step events will be skipped');
    }

    for (const record of event.Records) {
      // Create a subsegment for each record
      const recordSegment = streamSegment?.addNewSubsegment(`Record-${record.eventID}`);
      recordSegment?.addAnnotation('EventName', record.eventName || 'Unknown');
      recordSegment?.addAnnotation('EventSource', record.eventSource || 'Unknown');

      try {
        if (record.eventName === 'INSERT' || record.eventName === 'MODIFY') {
          const newImage = record.dynamodb?.NewImage;
          const oldImage = record.dynamodb?.OldImage;

          if (!newImage) {
            recordSegment?.addAnnotation('Status', 'Skipped-NoNewImage');
            continue;
          }

          // Check if status has changed to ONBOARDED
          const newStatus = newImage.status?.S;
          const oldStatus = oldImage?.status?.S;

          // Only publish if status changed to ONBOARDED
          if (newStatus === OnboardingStatus.ONBOARDED && oldStatus !== OnboardingStatus.ONBOARDED) {
            const userId = newImage.userId?.S;

            if (!userId) {
              recordSegment?.addAnnotation('Status', 'Skipped-NoUserId');
              console.log('No userId found in record, skipping SNS publish');
              continue;
            }

            // Extract all available DynamoDB columns
            const message: any = {
              userId: userId,
              status: newStatus,
              eventType: 'ORGANIZATION_ONBOARDED',
              timestamp: new Date().toISOString(),
              source: 'dynamodb_stream'
            };

            if (newImage.userEmail?.S) {
              message.userEmail = newImage.userEmail.S;
            }

            // Add pmbData if available
            if (newImage.pmbData?.S) {
              try {
                message.pmbData = JSON.parse(newImage.pmbData.S);
              } catch (parseError) {
                console.warn('Failed to parse pmbData as JSON:', parseError);
                message.pmbData = newImage.pmbData.S; // Include as string if parsing fails
              }
            }

            // Add merchantData if available
            const merchantData = newImage.merchantData?.S || newImage.merchant_data?.S;
            if (merchantData && merchantData.trim() !== '') {
              try {
                const parsedMerchantData = JSON.parse(merchantData);
                message.merchantData = {
                  legalEntity: parsedMerchantData.legalEntity,
                  // Note: PMB expects an array of stores, even if we only support 1 right now
                  // at some point we will support multiple stores
                  stores: [parsedMerchantData.store]
                };
              } catch (parseError) {
                recordSegment?.addAnnotation('Status', 'Failed-InvalidJSON');
                console.error('Invalid JSON in merchantData:', parseError, 'Data:', merchantData);
                message.merchantData = merchantData; // Include as string if parsing fails
              }
            }

            // Add adyenData if available
            if (newImage.adyenData?.S) {
              try {
                message.adyenData = JSON.parse(newImage.adyenData.S);
              } catch (parseError) {
                console.warn('Failed to parse adyenData as JSON:', parseError);
                message.adyenData = newImage.adyenData.S; // Include as string if parsing fails
              }
            }

            // Add submissionCount if available
            if (newImage.submissionCount?.N) {
              message.submissionCount = parseInt(newImage.submissionCount.N);
            }

            // Add timestamps if available
            if (newImage.createdAt?.S) {
              message.createdAt = newImage.createdAt.S;
            }

            if (newImage.updatedAt?.S) {
              message.updatedAt = newImage.updatedAt.S;
            }

            // Add agreementTimeStamp if available
            if (newImage.agreementTimeStamp?.S) {
              message.agreementTimeStamp = newImage.agreementTimeStamp.S;
            }

            // Add onboardedAt if available
            if (newImage.onboardedAt?.S) {
              message.onboardedAt = newImage.onboardedAt.S;
              console.log('Found onboardedAt in DynamoDB:', newImage.onboardedAt.S);
            } else if (newStatus === OnboardingStatus.ONBOARDED) {
              // If status is ONBOARDED but no onboardedAt timestamp, use current time
              message.onboardedAt = new Date().toISOString();
              console.log('No onboardedAt found, using current time:', message.onboardedAt);
            }



            // Create a subsegment for SNS publish
            const snsSegment = recordSegment?.addNewSubsegment('SNSPublish');
            try {
              await snsClient.send(
                new PublishCommand({
                  TopicArn: onboardedTopicArn,
                  Message: JSON.stringify(message),
                  Subject: 'Onboarded Event: Organization Onboarded',
                })
              );
              snsSegment?.addAnnotation('Status', 'Success');
              console.log('Onboarded event published to SNS:', message);
            } catch (snsError) {
              snsSegment?.addError(snsError as Error);
              console.error('Failed to publish onboarded event to SNS:', snsError);
              throw snsError;
            } finally {
              snsSegment?.close();
            }
          } else {
            recordSegment?.addAnnotation('Status', 'Skipped-StatusNotOnboarded');
            console.log(
              'Status not changed to ONBOARDED, skipping SNS publish. New status:', newStatus, 'Old status:', oldStatus
            );
          }

          // Check for group step completion (providerGroupName and phoneNumber in pmbData)
          // This check is independent of onboarding status and runs for all INSERT/MODIFY events
          if (newImage.pmbData?.S) {
            try {
              const pmbData = JSON.parse(newImage.pmbData.S);
              const providerGroupName = pmbData.providerGroupName;
              const phoneNumber = pmbData.phoneNumber;

              // Check if both required fields are present
              if (providerGroupName && phoneNumber) {
                // Check if this is the first time this data is being added
                // For INSERT events, this is always the first time
                // For MODIFY events, check if the old data didn't have both fields
                let isFirstTime = false;
                
                if (record.eventName === 'INSERT') {
                  isFirstTime = true;
                } else if (record.eventName === 'MODIFY' && oldImage?.pmbData?.S) {
                  try {
                    const oldPmbData = JSON.parse(oldImage.pmbData.S);
                    const oldProviderGroupName = oldPmbData.providerGroupName;
                    const oldPhoneNumber = oldPmbData.phoneNumber;
                    
                    // Only trigger if this is the first time both fields are present
                    isFirstTime = !(oldProviderGroupName && oldPhoneNumber);
                  } catch (oldPmbDataParseError) {
                    // If we can't parse old data, assume it's first time
                    isFirstTime = true;
                    console.warn('Failed to parse old pmbData, assuming first time:', oldPmbDataParseError);
                  }
                } else {
                  // For MODIFY events without old pmbData, assume it's first time
                  isFirstTime = true;
                }

                if (isFirstTime) {
                  // Extract user information from the record
                  const userId = newImage.userId?.S;
                  const email = newImage.userEmail?.S;

                  if (userId && email) {
                    const groupStepMessage = {
                      userName: userId,
                      email: email,
                      eventType: 'GROUP_STEP_COMPLETED',
                      timestamp: new Date().toISOString(),
                      triggerSource: 'dynamodb_stream',
                      providerGroupName: providerGroupName,
                      phoneNumber: phoneNumber
                    };

                    // Create a subsegment for group step SNS publish
                    const groupStepSnsSegment = recordSegment?.addNewSubsegment('GroupStepSNSPublish');
                    try {
                      if (groupStepCompletedTopicArn) {
                        await snsClient.send(
                          new PublishCommand({
                            TopicArn: groupStepCompletedTopicArn,
                            Message: JSON.stringify(groupStepMessage),
                            Subject: 'Group Step Completed Event',
                          })
                        );
                        groupStepSnsSegment?.addAnnotation('Status', 'Success');
                        console.log('Group step completed event published to SNS:', groupStepMessage);
                      } else {
                        console.warn('GROUP_STEP_COMPLETED_TOPIC_ARN not set, skipping group step event publish');
                      }
                    } catch (groupStepSnsError) {
                      groupStepSnsSegment?.addError(groupStepSnsError as Error);
                      console.error('Failed to publish group step completed event to SNS:', groupStepSnsError);
                      // Don't throw error for group step events to avoid blocking other processing
                    } finally {
                      groupStepSnsSegment?.close();
                    }
                  }
                } else {
                  console.log('Group step data already exists, skipping event publish. providerGroupName:', providerGroupName, 'phoneNumber:', phoneNumber);
                }
              }
            } catch (pmbDataParseError) {
              console.warn('Failed to parse pmbData for group step completion check:', pmbDataParseError);
            }
          }
        }
      } catch (error) {
        recordSegment?.addError(error as Error);
        console.error('Error processing record:', error);
        throw error;
      } finally {
        recordSegment?.close();
      }
    }
  } catch (error) {
    streamSegment?.addError(error as Error);
    console.error('Error processing DynamoDB stream event:', error);
    throw error;
  } finally {
    streamSegment?.close();
  }
};

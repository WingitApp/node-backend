const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp(functions.config().firebase);

// // Create and Deploy Your First Cloud Functions
// // https://firebase.google.com/docs/functions/write-firebase-functions
//
// exports.helloWorld = functions.https.onRequest((request, response) => {
//  response.send("Hello from Firebase!");
// });

exports.maintainTimestamps = functions.firestore
.document('{colId}/{docId}')
.onWrite(async (change, context) => {

    // the collections you want to trigger
    const setCols = ['all_posts', 'timeline', 'users'];

    // if not one of the collections listed above, return
    if (setCols.indexOf(context.params.colId) === -1) {
        return null;
    }

    // simplify event types
    const createDoc = change.after.exists && !change.before.exists;
    const updateDoc = change.before.exists && change.after.exists;
    const deleteDoc = change.before.exists && !change.after.exists;

    if (deleteDoc) {
        return null;
    }
    // simplify input data
    const after = change.after.exists ? change.after.data() : null;
    const before = change.before.exists ? change.before.data() : null;

    // prevent update loops from triggers
    const canUpdate = () => {
        // if update trigger
        if (before.updatedAt && after.updatedAt) {
            if (after.updatedAt._seconds !== before.updatedAt._seconds) {
                return false;
            }
        }
        // if create trigger
        if (!before.createdAt && after.createdAt) {
            return false;
        }
        return true;
    }

    // add createdAt
    if (createDoc) {
        return change.after.ref.set({
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true })
            .catch(e => {
                console.log(e);
                return false;
            });
    }
    // add updatedAt
    if (updateDoc && canUpdate()) {
        return change.after.ref.set({
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true })
            .catch(e => {
                console.log(e);
                return false;
            });
    }
    return null;
});

    exports.onCreateConnection = functions.firestore
        .document('/connections/{userId}/userConnections/{connectionId}')
        .onCreate(async (snapshot, context) => {
            console.log("Connection Created", snapshot.id);
            const userId = context.params.userId
            const connectionId = context.params.connectionId

            // Ensure connection is bi-directional
            admin.firestore().collection("connections").doc(connectionId).collection("userConnections").doc(userId).set({});

            admin.firestore().collection("connectRequests").doc(userId).collection("userSentRequests").doc(connectionId).delete();
            admin.firestore().collection("connectRequests").doc(connectionId).collection("userReceivedRequests").doc(userId).delete();

            const connectingUsersPostsRef = admin.firestore().collection("all_posts").where('ownerId', '==', userId);

            // Create connected user's timeline ref
            const timelinePostsRef = admin.firestore().collection("timeline").doc(connectionId).collection("timelinePosts");

            // Get users myPosts
            const querySnapshot = await connectingUsersPostsRef.get();

            // Add the connected users requests to connecting user's timelinePosts
            querySnapshot.forEach(doc => {
              if (doc.exists) {
                 const postId = doc.id
                 const postData = doc.data();
                 timelinePostsRef.doc(postId).set(postData);
              }
            });
        });

    exports.onDeleteSentConnectRequest = functions.firestore
    .document('/connectRequests/{senderId}/userSentRequests/{recipientId}')
    .onDelete(async (snapshot, context) => {
        const senderId = context.params.senderId;
        const recipientId = context.params.recipientId;

        // Ensure that both directions of the connect request are deleted.
        await admin.firestore().collection("connectRequests").doc(recipientId).collection("userReceivedRequests").doc(senderId).delete();

        const connectRequestNotificationQuery = admin.firestore().collection("activity").doc(recipientId).collection("feedItems").where("type", "==", "connectRequest").where("userId", "==", senderId);
        const connectRequestNotificationSnapshot = await connectRequestNotificationQuery.get();

        connectRequestNotificationSnapshot.forEach(doc => {
          if (doc.exists) {
            doc.ref.delete();
          }
        });
    });

    exports.onDeleteReceivedConnectRequest = functions.firestore
    .document('/connectRequests/{recipientId}/userReceivedRequests/{senderId}')
    .onDelete(async (snapshot, context) => {
      const recipientId = context.params.recipientId;
      const senderId = context.params.senderId;

      // Ensure that both directions of the connect request are deleted.
      await admin.firestore().collection("connectRequests").doc(senderId).collection("userSentRequests").doc(recipientId).delete();

      const connectRequestNotificationQuery = admin.firestore().collection("activity").doc(recipientId).collection("feedItems").where("type", "==", "connectRequest").where("userId", "==", senderId);
      const connectRequestNotificationSnapshot = await connectRequestNotificationQuery.get();

      connectRequestNotificationSnapshot.forEach(doc => {
        if (doc.exists) {
          doc.ref.delete();
        }
      });
    });

    exports.onDeleteConnection = functions.firestore
      .document('/connections/{userId}/userConnections/{connectionId}')
      .onDelete(async (snapshot, context) => {

          console.log("Connection Deleted", snapshot.id);
          const userId = context.params.userId;
          const connectionId = context.params.connectionId;

          // Ensure that both directions of the connection are deleted.
          admin.firestore().collection("connections").doc(connectionId).collection("userConnections").doc(userId).delete();

          const timelinePostsRefSelf = admin.firestore().collection("timeline").doc(connectionId).collection("timelinePosts").where("ownerId", "==", userId);
          const timelinePostsRefConnection = admin.firestore().collection("timeline").doc(userId).collection("timelinePosts").where("ownerId", "==", connectionId);
          const querySnapshotSelf = await timelinePostsRefSelf.get();
          const querySnapshotConnection = await timelinePostsRefConnection.get();

          querySnapshotSelf.forEach(doc => {
            if (doc.exists) {
              doc.ref.delete();
            }
          });
          querySnapshotConnection.forEach(doc => {
            if (doc.exists) {
              doc.ref.delete();
            }
          });
      });

  exports.onCreatePost = functions.firestore
    .document('/all_posts/{postId}')
    .onCreate(async (snapshot, context) => {

        const postData = snapshot.data();
        const { ownerId } = postData;
        const postId = context.params.postId;

        const userConnectionsRef = admin.firestore().collection("connections").doc(ownerId).collection("userConnections");

        const connectionsQuerySnapshot = await userConnectionsRef.get();

        connectionsQuerySnapshot.forEach(doc => {
          const connectionId = doc.id;
          admin.firestore().collection("timeline").doc(connectionId).collection("timelinePosts").doc(postId).set(postData);
        });
    });

    exports.onCreateReferral = functions.firestore
    .document('/referrals/{referralId}')
    .onCreate(async (snapshot, context) => {

      /*
       * [START] Add the sender into "bumpers" collection
       */
      const referral = snapshot.data()
      const { askId, senderId, receiverId, recipientId } = referral;

      const senderUserRef = admin.firestore().collection("users").doc(senderId);
      const senderUserSnapshot = await senderUserRef.get();
      const sender = senderUserSnapshot.data();

      // receiverId has been deprecated and we will use recipientId instead now
      const receiverUserRef = admin.firestore().collection("users").doc(receiverId);
      const receiverUserSnapshot = await receiverUserRef.get();
      const receiver = receiverUserSnapshot.data();

      const recipientUserRef = admin.firestore().collection("users").doc(recipientId);
      const recipientUserSnapshot = await recipientUserRef.get();
      const recipient = recipientUserSnapshot.data();

      const senderBumpedPostsRef = senderUserRef.collection("bumpedPosts").doc(askId).collection("users")

      const receiverIsInSenderBumpedGroup = await senderBumpedPostsRef.doc(receiverId).get();
      const recipientIsInSenderBumpedGroup = await senderBumpedPostsRef.doc(recipientId).get();
      const senderIsInPostBumperGroup = await admin.firestore().collection("all_posts").doc(askId).collection("bumpers").doc(senderId).get();


      if (!senderIsInPostBumperGroup.exists) {
        // add receiver to post's bumper group
        admin.firestore().collection("all_posts").doc(askId).collection("bumpers").doc(senderId).set(sender);
      }

      if (!receiverIsInSenderBumpedGroup.exists) {
        // add receiver to user's post bump group
        senderBumpedPostsRef.doc(receiverId).set(receiver);
      } 

      if (!recipientIsInSenderBumpedGroup.exists) {
        // add recipient to user's post bump group
        senderBumpedPostsRef.doc(recipientId).set(recipient);
      } 
    });

    exports.onUpdateReferral = functions.firestore
    .document('/referrals/{referralId}')
    .onUpdate(async (snapshot, context) => {

        const referral = snapshot.after.data();
        const { askId, senderId, receiverId, recipientId, status } = referral;

        /*
         * Add Receiver as Winger onAccept
         */
        if (status === "accepted") {
          
          // receiverId has been deprecated and we will use recipientId instead now
          const receiverUserRef = admin.firestore().collection("users").doc(receiverId);
          const receiverUserSnapshot = await receiverUserRef.get();
          const receiver = receiverUserSnapshot.data();

          const recipientUserRef = admin.firestore().collection("users").doc(recipientId);
          const recipientUserSnapshot = await recipientUserRef.get();
          const recipient = recipientUserSnapshot.data();

          const wingerUserRef =  admin.firestore().collection("all_posts").doc(askId).collection("wingers").doc(receiverId)
          const wingerUserSnapshot = await wingerUserRef.get();

          if (!wingerUserSnapshot.exists) {
            admin.firestore().collection("all_posts").doc(askId).collection("wingers").doc(receiverId).set(receiver);
          }
          
          const wingerRef =  admin.firestore().collection("all_posts").doc(askId).collection("wingers").doc(recipientId)
          const wingerSnapshot = await wingerRef.get();
          if (!wingerSnapshot.exists) {
            admin.firestore().collection("all_posts").doc(askId).collection("wingers").doc(recipientId).set(recipient);
          }
        }
    });

    exports.onUpdatePost = functions.firestore
      .document('/all_posts/{postId}')
      .onUpdate(async (snapshot, context) => {
        const newPostData = snapshot.after.data();
        const oldPostData = snapshot.before.data();

        const { ownerId } = newPostData;
        const { postId } = context.params;

        // Reject updates that occur within 500 milliseconds of their previous update
        if (newPostData.updatedAt.toMillis() - oldPostData.updatedAt.toMillis() < 500) {
          return;
        }

        const userConnectionsRef = admin.firestore().collection("connections").doc(ownerId).collection("userConnections");
        const connectionsQuerySnapshot = await userConnectionsRef.get();

        connectionsQuerySnapshot.forEach(doc => {
          // update the timeline of user's connections
          const connectionId = doc.id;
          admin.firestore().collection("timeline").doc(connectionId).collection("timelinePosts").doc(postId).set(newPostData);
        });

        // update the timeline of user
        admin.firestore().collection("timeline").doc(ownerId).collection("timelinePosts").doc(postId).set(newPostData)
    });

    exports.onUpdateTimelinePost = functions.firestore
      .document('/timeline/{ownerId}/timelinePosts/{postId}')
      .onUpdate(async (snapshot, context) => {
        const newPostData = snapshot.after.data();
        const oldPostData = snapshot.before.data();
        
        const { postId, ownerId } = context.params;

        // Reject updates that occur within 500 milliseconds of their previous update
        if (newPostData.updatedAt.toMillis() - oldPostData.updatedAt.toMillis() < 500) {
          return;
        }

        // Update the user's post (this will trigger the update for connections' timelines)
        admin.firestore().collection("all_posts").doc(postId).set(newPostData)
    });

    exports.onDeletePost = functions.firestore
        .document('/all_posts/{postId}')
        .onDelete(async (snapshot, context) => {

            const postData = snapshot.data();
            const { ownerId } = postData;
            const postId = context.params.postId;
            await admin.firestore().collection("timeline").doc(ownerId).collection("timelinePosts").doc(postId).delete();

            const userConnectionsRef = admin.firestore().collection("connections").doc(ownerId).collection("userConnections");
            const connectionsQuerySnapshot = await userConnectionsRef.get();
            connectionsQuerySnapshot.forEach(doc => {
              const connectionId = doc.id;
              admin.firestore().collection("timeline").doc(connectionId).collection("timelinePosts").doc(postId).delete();
            });

            const referralsReceivedForPost = admin.firestore().collection("referrals").where('askId', '==', postId);
            const referralsSnapshot = await referralsReceivedForPost.get();
            
            const referralDeleteCalls = [];
            referralsSnapshot.forEach(doc => {
              const referralId = doc.id;
              referralDeleteCalls.push(admin.firestore().collection("referrals").doc(referralId).delete());
            });
            await Promise.all(referralDeleteCalls);

            const commentsForPost = admin.firestore().collection("comments").doc(postId).collection("postComments");
            const commentsSnapshot = await commentsForPost.get();
            
            const commentDeleteCalls = [];
            commentsSnapshot.forEach(doc => {
              commentDeleteCalls(doc.ref.delete());
            });
            await Promise.all(commentDeleteCalls);

            // activity for a post could potentially end up in any user's notifications, so we need to check all users
            const activityRef = admin.firestore().collection("activity");
            const allUsersSnapshot = await activityRef.get();
            
            const feedItemQueries = []
            allUsersSnapshot.forEach(doc => {
              const userId = doc.id;
              postActivitiesRef = admin.firestore().collection("activity").doc(userId).collection("feedItems").where('postId', '==', postId);
              feedItemQueries.push(postActivitiesRef.get());
            });

            const feedItemsSnapshots = await Promise.all(feedItemQueries)
            const feedItemDeleteCalls = []
            feedItemsSnapshots.forEach(snapshot => {
              snapshot.forEach(doc => {
                feedItemDeleteCalls.push(doc.ref.delete());
              });
            });
            await Promise.all(feedItemDeleteCalls);
        });

        exports.onDeleteUser = functions.firestore
        .document('/users/{userId}')
        .onDelete(async (snapshot, context) => {
            const deletedUserId = context.params.userId;

            const connectionsForDeletedUserRef = admin.firestore().collection("connections").doc(deletedUserId).collection("userConnections");
            const connectionsForDeletedUser = await connectionsForDeletedUserRef.get();

            const connectionDeleteCalls = []
            connectionsForDeletedUser.forEach(doc => {
              if (doc.exists) {
                connectionDeleteCalls.push(doc.ref.delete());
              }
            });
            await Promise.all(connectionDeleteCalls);
        });

  exports.onCreateUserActivity = functions.firestore
  .document('/userActivity/{currentUserId}/activity/{activityId}')
  .onCreate( async (snapshot, event) => {

    const activityData = snapshot.data();
    const { activityId, currentUserId } = event.params

    // Convert UserActivity data into respective Notification data
    let notificationData = {
      activityId: activityId,
      correspondingUserDisplayName: activityData.currentUserDisplayName,
      correspondingUserId: currentUserId,
      mediaUrl: mediaUrl,
      notificationType: activityData.activityType,
      postTitle: activityData.postTitle,
      postType: activityData.postType
    };
    
    // Generate a new notification doc.
    var newNotificationRef = admin.firestore().collection("notifications").doc(currentUserId).collection("notifications").doc()
    newNotificationRef.set(notificationData)
  });

exports.onCreateNotificationCreatePush = functions.firestore
  .document('/notifications/{userId}/notifications/{notificationId}')
  .onCreate( async (snapshot, event) => {

    const data = snapshot.data();
    const { 
      activityId,
      currentUserDisplayName,
      currentUserId,
      mediaUrl,
      notificationType,
      postTitle,
      postType,
    } = data;
    const { recipientId } = event.params

    const formatNotificationString = (notificationType, currentUserDisplayName) => {
      switch(notificationType) {
        case "acceptConnectRequest":
          return `${currentUserDisplayName} accepted your connect request.`
        case "followPost":
          return `${currentUserDisplayName} has referred you to help their friend.`
        case "postAsk":
          return `${currentUserDisplayName} has commented on your post`
        case "postComment":
          return `${currentUserDisplayName} wants to connect with you.`
        case "reactToComment":
          return `${currentUserDisplayName} reacted to your comment.`
        case "referConnection":
          return `${currentUserDisplayName} has referred you to help their friend.`
        case "sendConnectRequest":
          return `${currentUserDisplayName} wants to connect with you.`
        case "referred":
          return `${currentUserDisplayName} has referred you to help their friend.`
        case "wingAsk":
          return `${currentUserDisplayName} has winged your post `
        default: 
          return null;
      }
    }

    const devices = await admin.firestore().collection('devices').where('userId', '==', recipientId).get()

    const tokenSet = new Set(); // user's unique device token

    for (const device of devices.docs) {
      const token = device.data().pushNotificationToken;
      
      token && tokenSet.add(token);
    }

    const tokens = [...tokenSet]; 
    
    const body = formatNotificationString(type, username);

    if (body) {
      const payload = {
        notification: {
            body,
            sound: "default"
        }
      }

      try {
        const response = await admin.messaging().sendToDevice(tokens, payload);
        functions.logger.log("push-notifications-response:", response);
      } catch (err) {
        functions.logger.log("notification error", err);
      }
    } else {
      functions.logger.log("Notification is not of push notification type");
    }
});

// Listens for bumps/referrals
exports.onActivityCreatePushNotifs = functions.firestore
  .document('/activity/{recipientId}/feedItems/{itemId}')
  .onCreate( async (snapshot, event) => {

    const data = snapshot.data();
    const { 
      type, 
      username, // sender
    } = data;
    const { recipientId } = event.params

    const devices = await admin.firestore().collection('devices').where('userId', '==', recipientId).get()

    const tokenSet = new Set(); // user's unique device token

    for (const device of devices.docs) {
      const token = device.data().pushNotificationToken;
      
      token && tokenSet.add(token);
    }

    const tokens = [...tokenSet]; 

    const formatNotificationString = (type, username) => {
      switch(type) {
        case "connectRequest":
          return `${username} wants to connect with you.`
        case "connectRequestAccepted":
          return `${username} accepted your connect request.`
        case "referred":
          return `${username} has referred you to help their friend.`
        case "comment":
          return `${username} has commented on your post`
        default: 
          return null;
      }
    }
    
    const body = formatNotificationString(type, username);

    if (body) {
      const payload = {
        notification: {
            body,
            sound: "default"
        },
        data: {
          activityId: data.activityId,
          comment: data.comment,
          mediaUrl: data.mediaUrl,
          postId: data.postId,
          type: data.type,
          userAvatar: data.userAvatar,
          userId: data.userId,
          username: data.username,
        },
      }

      try {
        const response = await admin.messaging().sendToDevice(tokens, payload);
        functions.logger.log("push-notifications-response:", response);
      } catch (err) {
        functions.logger.log("notification error", err);
      }
    } else {
      functions.logger.log("Activity is not of push notification type");
    }
});

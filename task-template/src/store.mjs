import { conversations } from "./sample-data.mjs";

export function createConversationStore(initialConversations = conversations) {
  const state = {
    conversations: initialConversations.map((conversation) => ({
      ...conversation,
      messages: conversation.messages.map((message) => ({ ...message }))
    }))
  };

  return {
    listConversations() {
      return state.conversations.map((conversation) => ({
        ...conversation,
        messages: conversation.messages.map((message) => ({ ...message }))
      }));
    },
    getConversation(id) {
      const conversation = state.conversations.find((item) => item.id === id);
      if (!conversation) throw new Error(`Unknown conversation: ${id}`);
      return {
        ...conversation,
        messages: conversation.messages.map((message) => ({ ...message }))
      };
    },
    addMessage(conversationId, role, content) {
      if (!["user", "assistant"].includes(role)) throw new Error("Unsupported message role");
      if (!content || content.trim().length < 2) throw new Error("Message cannot be empty");

      const conversation = state.conversations.find((item) => item.id === conversationId);
      if (!conversation) throw new Error(`Unknown conversation: ${conversationId}`);

      const message = {
        id: `m${conversation.messages.length + 1}`,
        role,
        content: content.trim(),
        createdAt: new Date().toISOString()
      };
      conversation.messages.push(message);
      return { ...message };
    }
  };
}

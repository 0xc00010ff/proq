'use client';

import { useState } from 'react';
import { TerminalIcon } from 'lucide-react';
import { ChatPanel } from '@/components/ChatPanel';
import { ThemeToggle } from '@/components/ThemeToggle';
import type { ChatLogEntry } from '@/lib/types';

export default function ChatPage() {
  const [mainChatMessages, setMainChatMessages] = useState<ChatLogEntry[]>([
    {
      role: 'proq',
      message: "Hey! I'm your AI assistant. Ask me anything across all your projects.",
      timestamp: new Date().toISOString(),
    },
  ]);

  const sendMainChatMessage = (content: string) => {
    const entry: ChatLogEntry = {
      role: 'user',
      message: content,
      timestamp: new Date().toISOString(),
    };
    setMainChatMessages((prev) => [...prev, entry]);
  };

  return (
    <>
      <header className="h-16 border-b border-gunmetal-300 dark:border-zinc-800 bg-gunmetal-50 dark:bg-zinc-950 flex items-center justify-between px-6 flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <TerminalIcon className="w-5 h-5 text-gunmetal-500" />
          <h1 className="text-lg font-semibold text-gunmetal-900 dark:text-zinc-100 leading-tight">Chat</h1>
        </div>
        <ThemeToggle />
      </header>
      <main className="flex-1 flex flex-col overflow-hidden">
        <ChatPanel
          messages={mainChatMessages}
          onSendMessage={sendMainChatMessage}
          style={{ flex: 1 }}
        />
      </main>
    </>
  );
}

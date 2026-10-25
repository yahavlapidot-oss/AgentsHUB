/** Phones show the chat list here; wider screens show it beside this. */
export default function ChatsPage() {
  return (
    <div className="hidden h-full place-items-center p-8 text-center md:grid">
      <div>
        <p className="text-lg font-semibold">Talk to your work managers</p>
        <p className="mt-1 max-w-sm text-sm text-ink-soft">
          Pick a project to chat with the agent who runs it. Ask how things are going, or hand it a task in one line.
        </p>
      </div>
    </div>
  );
}

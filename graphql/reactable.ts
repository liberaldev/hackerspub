import { drizzleConnectionHelpers } from "@pothos/plugin-drizzle";
import type { RelationsFilter } from "@hackerspub/models/db";
import { type Uuid, validateUuid } from "@hackerspub/models/uuid";
import { Actor } from "./actor.ts";
import { builder, Node } from "./builder.ts";
import { assertNever } from "@std/assert/unstable-never";

export interface Reactable {
  id: Uuid;
  reactionsCounts: Record<string, number>;
}

export const Reactable = builder.interfaceRef<Reactable>("Reactable");

Reactable.implement({
  interfaces: [Node],
  fields: (t) => ({
    reactionGroups: t.field({
      type: [ReactionGroup],
      resolve(post) {
        return Object.entries(post.reactionsCounts)
          .map(
            (
              [emojiOrId, count],
            ): EmojiReactionGroup | CustomEmojiReactionGroup => {
              return {
                subject: post,
                count,
                ...(validateUuid(emojiOrId)
                  ? {
                    type: "CustomEmoji",
                    customEmojiId: emojiOrId,
                    where: { customEmojiId: emojiOrId },
                  }
                  : {
                    type: "Emoji",
                    emoji: emojiOrId,
                    where: { emoji: emojiOrId },
                  }),
              };
            },
          );
      },
    }),
  }),
});

export interface ReactionGroup {
  type: "Emoji" | "CustomEmoji";
  subject: Reactable;
  count: number;
  where: RelationsFilter<"reactionTable">;
}

export const ReactionGroup = builder.interfaceRef<ReactionGroup>(
  "ReactionGroup",
).implement({
  resolveType(group) {
    switch (group.type) {
      case "Emoji":
        return EmojiReactionGroup.name;
      case "CustomEmoji":
        return CustomEmojiReactionGroup.name;
      default:
        assertNever(group.type, `Unknown reaction group type: ${group.type}`);
    }
  },
  fields: (t) => ({
    subject: t.field({ type: Reactable, resolve: (group) => group.subject }),
    reactors: t.connection({
      type: Actor,
      async resolve(group, args, ctx, info) {
        const query = reactorConnectionHelpers.getQuery(args, ctx, info);
        const reactions = await ctx.db.query.reactionTable.findMany({
          ...query,
          where: {
            ...query.where,
            ...group.where,
          },
        });
        return {
          totalCount: group.count,
          ...reactorConnectionHelpers.resolve(reactions, args, ctx),
        };
      },
    }, {
      fields: (t) => ({
        totalCount: t.exposeInt("totalCount"),
      }),
    }),
  }),
});

const reactorConnectionHelpers = drizzleConnectionHelpers(
  builder,
  "reactionTable",
  {
    select: (nodeSelection) => ({
      with: {
        actor: nodeSelection(),
      },
    }),
    resolveNode: (reaction) => reaction.actor,
  },
);

export interface EmojiReactionGroup extends ReactionGroup {
  type: "Emoji";
  emoji: string;
}

const EmojiReactionGroup = builder.objectRef<EmojiReactionGroup>(
  "EmojiReactionGroup",
);

EmojiReactionGroup.implement({
  interfaces: [ReactionGroup],
  fields: (t) => ({
    emoji: t.exposeString("emoji"),
  }),
});

export interface CustomEmojiReactionGroup extends ReactionGroup {
  type: "CustomEmoji";
  customEmojiId: Uuid;
}

const CustomEmojiReactionGroup = builder.objectRef<CustomEmojiReactionGroup>(
  "CustomEmojiReactionGroup",
);

CustomEmojiReactionGroup.implement({
  interfaces: [ReactionGroup],
  fields: (t) => ({
    customEmoji: t.drizzleField({
      type: "customEmojiTable",
      async resolve(query, group, _, ctx) {
        const customEmoji = await ctx.db.query.customEmojiTable.findFirst(
          query({ where: { id: group.customEmojiId } }),
        );
        if (!customEmoji) throw new Error(`Custom emoji not found`);
        return customEmoji;
      },
    }),
  }),
});

builder.drizzleNode("customEmojiTable", {
  name: "CustomEmoji",
  id: {
    column: (emoji) => emoji.id,
  },
  fields: (t) => ({
    iri: t.field({
      type: "URL",
      resolve: (emoji) => new URL(emoji.iri),
    }),
    name: t.exposeString("name"),
    imageUrl: t.exposeString("imageUrl"),
  }),
});

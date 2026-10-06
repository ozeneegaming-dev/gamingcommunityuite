/**
 * Emoji-urile din selectorul chat-ului, pe categorii (Unicode: nu au nevoie de imagini și se văd în orice browser).
 * Cheia categoriei e și cheia de traducere (`chat.ui.emojiTabs.{key}`); iconița categoriei (Font Awesome) e în
 * `GcsChatEmojiPicker`.
 */
const CATEGORIES: { key: string; items: string[] }[] = [
  {
    key: "smileys",
    items: [..."😀😃😄😁😆😅🤣😂🙂🙃😉😊😇🥰😍🤩😘😗😚😙😋😛😜🤪😝🤑🤗🤭🤫🤔🤐🤨😐😑😶😏😒🙄😬🤥😌😔😪🤤😴😷🤒🤕🤢🤮🥵🥶🥴😵🤯🤠🥳😎🤓🧐😕😟🙁😮😯😲😳🥺😦😧😨😰😥😢😭😱😖😣😞😓😩😫🥱😤😡😠🤬😈👿💀💩🤡👻👽🤖"],
  },
  {
    key: "gestures",
    items: [
      ..."👍👎👊✊🤛🤜👏🙌👐🤲🤝🙏💪👋🤚🖐🤞🤟🤘🤙👈👉👆👇👌🤌🤏",
      "✌️",
      "☝️",
      ..."🫡🫶❤🧡💛💚💙💜🖤🤍🤎💔💯💢💥💫💦💨🔥✨⭐🌟💤",
    ],
  },
  {
    key: "gaming",
    items: [..."🎮🕹👾🎯🎲🧩♟🏆🥇🥈🥉🏅🎖⚔🛡🏹🔫💣🧨🪓🗡⚽🏀🏈⚾🎾🏐🏉🎱🏓🏸🥊🥋⛳🏎🏁🚩🎳🎰🃏🀄🎴"],
  },
  {
    key: "animals",
    items: [..."🐶🐱🐭🐹🐰🦊🐻🐼🐨🐯🦁🐮🐷🐸🐵🙈🙉🙊🐔🐧🐦🐤🦆🦅🦉🦇🐺🐗🐴🦄🐝🐛🦋🐌🐞🐜🐢🐍🦎🦖🦕🐙🦑🦀🐡🐠🐟🐬🐳🐋🦈🐊🐅🐆🦓🦍🐘🦒🐪🐄🐎🐖🐑🐐🦌🐕🐈🐓🦃🦚🦜🐇🐁🐀🐿🦔🐉🐲🌵🌲🌳🌴🌱🌿🍀🍁🍂🌷🌹🌺🌸🌼🌻"],
  },
  {
    key: "food",
    items: [..."🍏🍎🍐🍊🍋🍌🍉🍇🍓🫐🍈🍒🍑🥭🍍🥥🥝🍅🥑🍆🥔🥕🌽🌶🥒🥦🧄🧅🍄🥜🍞🥐🥖🥨🧀🥚🍳🥞🧇🥓🥩🍗🍖🌭🍔🍟🍕🥪🌮🌯🥗🍝🍜🍲🍛🍣🍱🥟🍤🍙🍚🍘🍦🍰🎂🧁🍫🍬🍭🍩🍪☕🍵🥤🧋🍺🍻🥂🍷🥃🍸🍹🧉🍾🧊"],
  },
  {
    key: "travel",
    items: [..."🚗🚕🚙🚌🏎🚓🚑🚒🚐🛻🚚🏍🛵🚲🛴🚨✈🚀🛸🚁⛵🚤🛳🚂🚆🚇🗺🗽🗼🏰🏯🏟🎡🎢🎠⛲🏖🏝🏜🌋⛰🏔🗻🏕🏠🏡🏢🏥🏦🏨🏪🏫⛪🕌🌍🌎🌏🌙🌞🌝🌛⭐🌈☀⛅☁🌧⛈🌩❄☃⛄🌊"],
  },
  {
    key: "objects",
    items: [..."⌚📱💻⌨🖥🖨🖱💽💾💿📀📷📸📹🎥📞☎📺📻🎙🎚🎛🧭⏱⏰⌛⏳📡🔋🔌💡🔦🕯💸💵💰💳💎⚖🔧🔨⚒🛠⛏🔩⚙🔑🗝🔒🔓🎁🎈🎉🎊🎀📦📫📝📌📍✂📎📏📐📚📖🔖🎧🎤🎬🎨🎸🎹🥁🎺🎷🎻"],
  },
  {
    key: "symbols",
    items: [
      "❤️",
      ..."💖💗💓💞💕💘💝💟❣☮✝☪🕉☸✡🔯☯☦⛎♈♉♊♋♌♍♎♏♐♑♒♓🆔⚛✅☑✔❌❎➕➖➗➰➿〽✳✴❇‼⁉❓❔❕❗⚠🚫⛔📛🔞🔅🔆🔱⚜🔰♻🆗🆒🆕🆓🆙🔝🔜🔛🔚🔙🎵🎶💲💱©®™🔴🟠🟡🟢🔵🟣⚫⚪🟥🟧🟨🟩🟦🟪⬛⬜",
    ],
  },
];

/** Fără selectoarele de variantă rămase singure după despărțirea pe caractere; fără dubluri. */
export const GCS_EMOJI = CATEGORIES.map((c) => ({ ...c, items: [...new Set(c.items.filter((e) => e !== "\uFE0F" && e !== "\u200D"))] }));

/**
 * Tab-ul „Emoticoane”: setul de bază, cele mai folosite (proiectul nu are emoticoane proprii, în imagini). Cele folosite
 * recent de viewer se adaugă înaintea lor, din browser.
 */
export const GCS_EMOTICONS = [..."🙂😀😃😄😁😆😅😂🤣😊😉😍😘😋😎🤩🥳🤔😐🙄😏😴😮😲😳🥺😢😭😤😡🤬😱🤯🤗🤭👍👎👏🙌🙏💪👋🤝🔥💯✨🎉🏆"];

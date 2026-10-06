/**
 * Emoticoanele din selectorul chat-ului, pe categorii (emoji Unicode: nu au nevoie de imagini și se văd în orice
 * browser). Cheia categoriei e și cheia de traducere (`chat.emojiTabs.{key}`).
 */
const CATEGORIES: { key: string; icon: string; items: string[] }[] = [
  {
    key: "smileys",
    icon: "😀",
    items: [..."😀😃😄😁😆😅🤣😂🙂🙃😉😊😇🥰😍🤩😘😗😚😙😋😛😜🤪😝🤑🤗🤭🤫🤔🤐🤨😐😑😶😏😒🙄😬🤥😌😔😪🤤😴😷🤒🤕🤢🤮🥵🥶🥴😵🤯🤠🥳😎🤓🧐😕😟🙁😮😯😲😳🥺😦😧😨😰😥😢😭😱😖😣😞😓😩😫🥱😤😡😠🤬😈👿💀💩🤡👻👽🤖"],
  },
  {
    key: "gestures",
    icon: "👍",
    items: [
      ..."👍👎👊✊🤛🤜👏🙌👐🤲🤝🙏💪👋🤚🖐🤞🤟🤘🤙👈👉👆👇👌🤌🤏",
      "✌️",
      "☝️",
      ..."🫡🫶❤🧡💛💚💙💜🖤🤍🤎💔💯💢💥💫💦💨🔥✨⭐🌟💤",
    ],
  },
  {
    key: "gaming",
    icon: "🎮",
    items: [..."🎮🕹👾🎯🎲🧩♟🏆🥇🥈🥉🏅🎖⚔🛡🏹🔫💣🧨🪓🗡⚽🏀🏈⚾🎾🏐🏉🎱🏓🏸🥊🥋⛳🏎🏁🚩🎳🎰🃏🀄🎴"],
  },
  {
    key: "animals",
    icon: "🐶",
    items: [..."🐶🐱🐭🐹🐰🦊🐻🐼🐨🐯🦁🐮🐷🐸🐵🙈🙉🙊🐔🐧🐦🐤🦆🦅🦉🦇🐺🐗🐴🦄🐝🐛🦋🐌🐞🐜🐢🐍🦎🦖🦕🐙🦑🦀🐡🐠🐟🐬🐳🐋🦈🐊🐅🐆🦓🦍🐘🦒🐪🐄🐎🐖🐑🐐🦌🐕🐈🐓🦃🦚🦜🐇🐁🐀🐿🦔🐉🐲🌵🌲🌳🌴🌱🌿🍀🍁🍂🌷🌹🌺🌸🌼🌻"],
  },
  {
    key: "food",
    icon: "🍕",
    items: [..."🍏🍎🍐🍊🍋🍌🍉🍇🍓🫐🍈🍒🍑🥭🍍🥥🥝🍅🥑🍆🥔🥕🌽🌶🥒🥦🧄🧅🍄🥜🍞🥐🥖🥨🧀🥚🍳🥞🧇🥓🥩🍗🍖🌭🍔🍟🍕🥪🌮🌯🥗🍝🍜🍲🍛🍣🍱🥟🍤🍙🍚🍘🍦🍰🎂🧁🍫🍬🍭🍩🍪☕🍵🥤🧋🍺🍻🥂🍷🥃🍸🍹🧉🍾🧊"],
  },
  {
    key: "travel",
    icon: "🚗",
    items: [..."🚗🚕🚙🚌🏎🚓🚑🚒🚐🛻🚚🏍🛵🚲🛴🚨✈🚀🛸🚁⛵🚤🛳🚂🚆🚇🗺🗽🗼🏰🏯🏟🎡🎢🎠⛲🏖🏝🏜🌋⛰🏔🗻🏕🏠🏡🏢🏥🏦🏨🏪🏫⛪🕌🌍🌎🌏🌙🌞🌝🌛⭐🌈☀⛅☁🌧⛈🌩❄☃⛄🌊"],
  },
  {
    key: "objects",
    icon: "💡",
    items: [..."⌚📱💻⌨🖥🖨🖱💽💾💿📀📷📸📹🎥📞☎📺📻🎙🎚🎛🧭⏱⏰⌛⏳📡🔋🔌💡🔦🕯💸💵💰💳💎⚖🔧🔨⚒🛠⛏🔩⚙🔑🗝🔒🔓🎁🎈🎉🎊🎀📦📫📝📌📍✂📎📏📐📚📖🔖🎧🎤🎬🎨🎸🎹🥁🎺🎷🎻"],
  },
  {
    key: "symbols",
    icon: "❤️",
    items: [
      "❤️",
      ..."💖💗💓💞💕💘💝💟❣☮✝☪🕉☸✡🔯☯☦⛎♈♉♊♋♌♍♎♏♐♑♒♓🆔⚛✅☑✔❌❎➕➖➗➰➿〽✳✴❇‼⁉❓❔❕❗⚠🚫⛔📛🔞🔅🔆🔱⚜🔰♻🆗🆒🆕🆓🆙🔝🔜🔛🔚🔙🎵🎶💲💱©®™🔴🟠🟡🟢🔵🟣⚫⚪🟥🟧🟨🟩🟦🟪⬛⬜",
    ],
  },
];

/** Fără selectoarele de variantă rămase singure după despărțirea pe caractere; fără dubluri. */
export const GCS_EMOJI = CATEGORIES.map((c) => ({ ...c, items: [...new Set(c.items.filter((e) => e !== "\uFE0F" && e !== "\u200D"))] }));

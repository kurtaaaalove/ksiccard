/**
 * 根據名片資料產生 LINE Flex Message JSON
 */

function buildFlexJson(card, domain) {
  const shareUrl = `${domain}/share/${card.slug}`;
  const tc = card.theme_color || '#06c755';

  // 解析 VIP 個別顏色設定，沒有就用 theme_color 統一風格
  let cc = {};
  try { cc = card.color_config ? JSON.parse(card.color_config) : {}; } catch (e) { cc = {}; }

  const bgColor = cc.bg || '#ffffff';
  const nameColor = cc.name || tc;
  const titleColor = cc.title || '#999999';
  const contactLabelColor = cc.contactLabel || '#aaaaaa';
  const contactValueColor = cc.contactValue || '#666666';
  const btnColor = cc.btn || tc;
  const footerBg = cc.footerBg || null;

  // 建立聯絡資訊列
  const contactItems = [];

  if (card.phone) {
    contactItems.push({
      type: 'box', layout: 'baseline', spacing: 'sm',
      contents: [
        { type: 'text', text: '電話', color: contactLabelColor, size: 'sm', flex: 1 },
        { type: 'text', text: card.phone, wrap: true, color: contactValueColor, size: 'sm', flex: 3,
          action: { type: 'uri', label: '撥打電話', uri: `tel:${card.phone}` }
        }
      ]
    });
  }

  if (card.email) {
    contactItems.push({
      type: 'box', layout: 'baseline', spacing: 'sm',
      contents: [
        { type: 'text', text: 'Email', color: contactLabelColor, size: 'sm', flex: 1 },
        { type: 'text', text: card.email, wrap: true, color: contactValueColor, size: 'sm', flex: 3,
          action: { type: 'uri', label: '寄信', uri: `mailto:${card.email}` }
        }
      ]
    });
  }

  if (card.line_id) {
    contactItems.push({
      type: 'box', layout: 'baseline', spacing: 'sm',
      contents: [
        { type: 'text', text: 'LINE', color: contactLabelColor, size: 'sm', flex: 1 },
        { type: 'text', text: card.line_id, wrap: true, color: contactValueColor, size: 'sm', flex: 3 }
      ]
    });
  }

  if (card.address) {
    contactItems.push({
      type: 'box', layout: 'baseline', spacing: 'sm',
      contents: [
        { type: 'text', text: '地址', color: contactLabelColor, size: 'sm', flex: 1 },
        { type: 'text', text: card.address, wrap: true, color: contactValueColor, size: 'sm', flex: 3 }
      ]
    });
  }

  if (card.website) {
    contactItems.push({
      type: 'box', layout: 'baseline', spacing: 'sm',
      contents: [
        { type: 'text', text: '網站', color: contactLabelColor, size: 'sm', flex: 1 },
        { type: 'text', text: card.website, wrap: true, color: btnColor, size: 'sm', flex: 3,
          action: { type: 'uri', label: '開啟網站', uri: card.website.startsWith('http') ? card.website : `https://${card.website}` }
        }
      ]
    });
  }

  // 社群連結按鈕
  const socialButtons = [];
  if (card.facebook) {
    socialButtons.push({
      type: 'button', style: 'link', height: 'sm',
      action: { type: 'uri', label: 'Facebook', uri: card.facebook }
    });
  }
  if (card.instagram) {
    socialButtons.push({
      type: 'button', style: 'link', height: 'sm',
      action: { type: 'uri', label: 'Instagram', uri: card.instagram }
    });
  }
  if (card.linkedin) {
    socialButtons.push({
      type: 'button', style: 'link', height: 'sm',
      action: { type: 'uri', label: 'LinkedIn', uri: card.linkedin }
    });
  }

  // Footer 內容
  const footerContents = [
    ...socialButtons,
    ...(card.allow_share ? [{
      type: 'button', style: 'primary', height: 'sm',
      color: btnColor,
      action: { type: 'uri', label: '分享此名片', uri: shareUrl }
    }] : []),
    {
      type: 'button', style: 'link', height: 'sm',
      action: { type: 'uri', label: 'KS-DIGI 電子名片', uri: domain }
    }
  ];

  // Hero 大圖
  const avatarUrl = card.avatar_url
    ? (card.avatar_url.startsWith('http') ? card.avatar_url : `${domain}${card.avatar_url}`)
    : null;

  // 組合 Flex Message
  const flex = {
    type: 'bubble',
    styles: {
      body: { backgroundColor: bgColor },
      ...(footerBg ? { footer: { backgroundColor: footerBg } } : {})
    },
    ...(avatarUrl ? {
      hero: {
        type: 'image',
        url: avatarUrl,
        size: 'full',
        aspectRatio: '1:1',
        aspectMode: 'cover'
      }
    } : {}),
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        { type: 'text', text: card.name, weight: 'bold', size: 'xl', color: nameColor },
        ...(card.title ? [{ type: 'text', text: card.title, size: 'xs', color: titleColor, margin: 'sm' }] : []),
        ...(card.company ? [{ type: 'text', text: card.company, size: 'sm', color: titleColor }] : []),
        { type: 'separator', margin: 'lg' },
        {
          type: 'box', layout: 'vertical', margin: 'lg', spacing: 'sm',
          contents: contactItems.length > 0 ? contactItems : [
            { type: 'text', text: '暫無聯絡資訊', color: '#aaaaaa', size: 'sm' }
          ]
        }
      ]
    },
    footer: {
      type: 'box', layout: 'vertical', spacing: 'sm', flex: 0,
      contents: footerContents
    }
  };

  return flex;
}

module.exports = { buildFlexJson };

/**
 * dsh-hsr 的客户端半边：在「设置」里注册一栏「HSR 数据库」。
 *
 * 这个文件由宿主的模块加载器（window.__ModuleLoader__）执行，只向基座要 react：
 * 设置区的 slot 渲染的是 React 树，所以面板本体用原生 DOM 搭好之后，
 * 由一个极薄的 React 组件通过 ref 挂进去，省掉手写整棵 React 元素树。
 * 宿主侧读写接口见 lib/index.js 的 registerRoutes()。
 */

window.__ModuleLoader__.load({
  id: 'dsh-hsr',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

    const React = require('react');

    const BASE = '/dsh-hsr/api';
    const SOURCE_TEXT = {
      setting: '使用设置里填写的代理',
      env: '使用环境变量里的代理',
      system: '使用系统（浏览器）代理',
      direct: '已强制直连',
      none: '直连',
    };

    function el(tag, style, text) {
      const node = document.createElement(tag);
      if (style) node.setAttribute('style', style);
      if (text !== undefined) node.textContent = text;
      return node;
    }

    const HINT = 'font-size:12px;line-height:1.6;opacity:.72;margin:0;';

    function field(title, hint) {
      const box = el('div', 'display:flex;flex-direction:column;gap:6px;');
      box.appendChild(el('div', 'font-size:13px;font-weight:600;', title));
      if (hint) box.appendChild(el('p', HINT, hint));
      return box;
    }

    function input(placeholder) {
      const node = el(
        'input',
        'width:100%;box-sizing:border-box;padding:8px 10px;border-radius:8px;border:1px solid rgba(128,128,128,.35);background:transparent;color:inherit;font:inherit;',
      );
      node.type = 'text';
      node.spellcheck = false;
      node.placeholder = placeholder;
      return node;
    }

    function textarea(placeholder, rows) {
      const node = el(
        'textarea',
        'width:100%;box-sizing:border-box;padding:8px 10px;border-radius:8px;border:1px solid rgba(128,128,128,.35);background:transparent;color:inherit;font:inherit;resize:vertical;',
      );
      node.rows = rows;
      node.spellcheck = false;
      node.placeholder = placeholder;
      return node;
    }

    function button(label, primary) {
      const node = el('button', '', label);
      node.type = 'button';
      node.setAttribute(
        'style',
        [
          'padding:7px 14px',
          'border-radius:8px',
          'font:inherit',
          'cursor:pointer',
          primary
            ? 'border:1px solid transparent;background:var(--dsh-accent,#3b82f6);color:#fff'
            : 'border:1px solid rgba(128,128,128,.4);background:transparent;color:inherit',
        ].join(';'),
      );
      return node;
    }

    async function request(path, options) {
      const response = await fetch(BASE + path, {
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        ...options,
      });
      const text = await response.text();
      let data = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = {};
      }
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      return data;
    }

    function createPanel() {
      const root = el('div', 'display:flex;flex-direction:column;gap:18px;padding:2px 0 8px;max-width:760px;');
      root.appendChild(el('h3', 'margin:0;font-size:16px;', 'HSR 数据库'));
      root.appendChild(
        el(
          'p',
          HINT,
          '这里的设置只作用于《崩坏：星穹铁道》资料查询插件，改完点保存即可生效。',
        ),
      );

      const proxyField = field(
        '代理',
        '留空表示跟随系统（浏览器）代理；填 direct 表示强制直连；也可以填 127.0.0.1:7897 这样的地址。',
      );
      const proxyInput = input('例如 127.0.0.1:7897');
      proxyField.appendChild(proxyInput);
      const proxyState = el('p', HINT, '');
      proxyField.appendChild(proxyState);
      root.appendChild(proxyField);

      const queryField = field(
        '查询经验',
        '在这里写你对角色的称呼与角色全称的对应关系，例如「板鸭 = 布洛妮娅」。模型查询时会先看这段。',
      );
      const queryInput = textarea('板鸭 = 布洛妮娅', 4);
      queryField.appendChild(queryInput);
      root.appendChild(queryField);

      const teamField = field(
        '配队经验',
        '在这里写你的配队偏好与已有角色、光锥、遗器。模型给出配队建议时会参考这段。',
      );
      const teamInput = textarea('常用的角色有……；倾向的打法是……', 6);
      teamField.appendChild(teamInput);
      root.appendChild(teamField);

      const status = el('p', `${HINT}min-height:18px;`, '');

      const row = el('div', 'display:flex;gap:10px;flex-wrap:wrap;align-items:center;');
      const save = button('保存', true);
      const reset = button('删除本机自识别经验');
      row.appendChild(save);
      row.appendChild(reset);
      row.appendChild(status);
      root.appendChild(row);

      const paths = el('p', HINT, '');
      root.appendChild(paths);

      let loaded = null;

      const apply = (data) => {
        loaded = data;
        proxyInput.value = data.proxy || '';
        queryInput.value = data.query || '';
        teamInput.value = data.team || '';
        const resolved = data.resolved || { proxy: '', source: 'none' };
        proxyState.textContent = resolved.proxy
          ? `当前实际走：${resolved.proxy}（${SOURCE_TEXT[resolved.source] || resolved.source}）`
          : `当前实际走：直连（${SOURCE_TEXT[resolved.source] || resolved.source}）`;
        if (data.paths) paths.textContent = `查询经验文件：${data.paths.query}　配队经验文件：${data.paths.team}`;
      };

      const load = async () => {
        status.textContent = '读取中…';
        try {
          apply(await request('/settings'));
          status.textContent = '';
        } catch (error) {
          status.textContent = `读取失败：${error.message}`;
        }
      };

      save.addEventListener('click', async () => {
        status.textContent = '保存中…';
        try {
          apply(
            await request('/settings', {
              method: 'POST',
              body: JSON.stringify({
                proxy: proxyInput.value,
                query: queryInput.value,
                team: teamInput.value,
              }),
            }),
          );
          status.textContent = '已保存。';
        } catch (error) {
          status.textContent = `保存失败：${error.message}`;
        }
      });

      reset.addEventListener('click', async () => {
        const ok = window.confirm(
          '确定要删除模型在本地写下的检验经验吗？删除后模型需要重新积累，这个操作不可撤销。',
        );
        if (!ok) return;
        status.textContent = '删除中…';
        try {
          await request('/clear-model-notes', { method: 'POST' });
          status.textContent = '已删除模型检验经验。';
        } catch (error) {
          status.textContent = `删除失败：${error.message}`;
        }
      });

      void load();
      return root;
    }

    const name = 'dsh-hsr';
    const inject = ['slots'];

    /**
     * 设置区的一栏。slot 要的是 React 组件，面板本体是原生 DOM，
     * 所以这里只放一个容器，等挂载完成后把 createPanel() 塞进去。
     */
    function SettingsSection() {
      const host = React.useRef(null);
      React.useEffect(() => {
        const node = host.current;
        if (!node) return undefined;
        const panel = createPanel();
        node.appendChild(panel);
        return () => {
          if (panel.parentNode === node) node.removeChild(panel);
        };
      }, []);
      return React.createElement('div', {
        ref: host,
        style: { display: 'flex', flexDirection: 'column', gap: '18px', padding: '4px 0' },
      });
    }

    function apply(ctx) {
      ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          {
            name: 'settings.section',
            id: 'dsh-hsr',
            order: 70,
            label: () => 'HSR 数据库',
            inject: () => ({}),
          },
          SettingsSection,
        ),
      );
    }

    exports.name = name;
    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  },
});

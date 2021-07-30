import React, {useEffect, useRef, useState} from 'react';
import {Replicache} from 'replicache';
import {useSubscribe} from 'replicache-react';
import Pusher from 'pusher-js';
import {nanoid} from 'nanoid';

const name = 'chat';

export default function Home() {
  const [rep, setRep] = useState(null);

  useEffect(() => {
    const rep = new Replicache({
      name,
      pushURL: '/api/replicache-push',
      pullURL: '/api/replicache-pull',
      // The .dev.wasm version is nice during development because it has
      // symbols and additional debugging info. The .wasm version is smaller
      // and faster.
      wasmModule: '/replicache.dev.wasm',
      mutators: {
        async createMessage(tx, {id, from, content, order, attachment}) {
          await tx.put(messageKey(id), {
            from,
            content,
            order,
            attachment,
          });
          if (attachment) {
            const hasBlob = await tx.has(blobKey(attachment));
            if (!hasBlob) {
              await tx.put(blobKey(attachment), {uploaded: false});
            }
          }
        },
        async addBlob(tx, {hash, uploaded}) {
          await tx.put(blobKey(hash), {uploaded});
        },
      },
    });

    listen(rep);
    setRep(rep);
  }, []);

  return rep && <Chat rep={rep} />;
}

const blobPrefix = 'blob/';

function Chat({rep}) {
  const messages = useSubscribe(
    rep,
    async tx => {
      const list = await tx.scan({prefix: 'message/'}).entries().toArray();
      list.sort(([, {order: a}], [, {order: b}]) => a - b);
      return list;
    },
    [],
  );

  const blobs = useSubscribe(
    rep,
    async tx => {
      return await tx.scan({prefix: blobPrefix}).entries().toArray();
    },
    [],
  );
  useEffect(() => {
    (async () => {
      const cache = await caches.open(name);
      for (const [k, v] of blobs) {
        const hash = k.slice(blobPrefix.length);
        syncBlob(rep, cache, hash, v.uploaded);
      }
    })();
  }, [blobs, rep]);

  const usernameRef = useRef();
  const contentRef = useRef();
  const fileRef = useRef();

  const onSubmit = async e => {
    e.preventDefault();
    const last = messages.length ? messages[messages.length - 1][1] : undefined;
    const order = (last?.order ?? 0) + 1;

    let hash = null;
    let uploadP;
    if (fileRef.current.files.length) {
      const {files} = fileRef.current;
      const data = await readFileAsUint8Array(files[0]);
      hash = await computeHash(data);
      await addBlobToCache(hash, data);
    }

    await rep.mutate.createMessage({
      id: nanoid(),
      from: usernameRef.current.value,
      content: contentRef.current.value,
      order,
      attachment: hash,
    });
    contentRef.current.value = '';
    fileRef.current.value = '';
    await uploadP;
  };

  return (
    <div style={styles.container}>
      <form style={styles.form} onSubmit={onSubmit}>
        <input ref={usernameRef} style={styles.username} required />
        says:
        <input ref={contentRef} style={styles.content} required />
        <input type="file" ref={fileRef} />
        <input type="submit" />
      </form>
      <MessageList messages={messages} />
    </div>
  );
}

async function readFileAsUint8Array(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result));
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

export async function computeHash(data) {
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf), b =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}

async function addBlobToCache(hash, data) {
  const cache = await caches.open(name);
  const blob = new Blob([data]);
  await cache.put(blobURL(hash), new Response(blob));
}

async function uploadBlob(rep, data, hash) {
  const blob = new Blob([data]);
  // Since we already have the blob here, we might as well add it to
  // the cache instead of redownloading it.
  await addBlobToCache(hash, data);
  const resp = await fetch(blobURL(hash), {
    method: 'PUT',
    body: data,
  });
  await rep.mutate.addBlob({hash, uploaded: resp.ok});
}

function Attachment({hash}) {
  const [url, setURL] = useState('');
  useEffect(() => {
    let mounted = true;
    const revoke = () => URL.revokeObjectURL(url);
    (async () => {
      const newURL = await getURLForHash(hash);
      revoke();
      if (mounted) {
        setURL(newURL);
      }
    })();

    return () => {
      mounted = false;
      revoke();
    };
  }, [hash]);
  return url ? <img src={url} height={50} /> : null;
}

function MessageList({messages}) {
  return (
    <>
      {messages.map(([k, v]) => {
        return (
          <div key={k}>
            <b>{v.from}: </b>
            {v.content}
            {v.attachment && (
              <>
                {' - '}
                <Attachment hash={v.attachment} />
              </>
            )}
          </div>
        );
      })}
    </>
  );
}

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
  },
  form: {
    display: 'flex',
    flexDirection: 'row',
    flex: 0,
    marginBottom: '1em',
  },
  username: {
    flex: 0,
    marginRight: '1em',
  },
  content: {
    flex: 1,
    maxWidth: '30em',
    margin: '0 1em',
  },
};

function listen(rep) {
  console.log('listening');
  // Listen for pokes, and pull whenever we get one.
  Pusher.logToConsole = true;
  if (!process.env.NEXT_PUBLIC_REPLICHAT_PUSHER_KEY) {
    throw new Error('process.env.NEXT_PUBLIC_REPLICHAT_PUSHER_KEY is not set');
  }
  const pusher = new Pusher(process.env.NEXT_PUBLIC_REPLICHAT_PUSHER_KEY, {
    cluster: process.env.NEXT_PUBLIC_REPLICHAT_PUSHER_CLUSTER,
  });
  const channel = pusher.subscribe('default');
  channel.bind('poke', () => {
    console.log('got poked');
    rep.pull();
  });
}

async function syncBlob(rep, cache, hash, uploaded) {
  const response = await cache.match(blobURL(hash));
  console.log('syncBlob', hash, uploaded, blobURL(hash), response?.ok);
  if (response) {
    if (!uploaded) {
      const buffer = await response.arrayBuffer();
      await uploadBlob(rep, new Uint8Array(buffer), hash);
    }
  } else {
    const resp = await downloadBlob(hash);
    if (resp.ok) {
      await cache.put(blobURL(hash), resp);
      if (!uploaded) {
        // Mark as uploaded, so we don't try to upload it again.
        await rep.mutate.addBlob({hash, uploaded: true});
      }
    }
  }
}

async function downloadBlob(hash) {
  return await fetch(blobURL(hash));
}

async function getURLForHash(hash) {
  const cache = await caches.open(name);
  let response = await cache.match(blobURL(hash));
  let blob;
  if (response && response.ok) {
    blob = await response.blob();
  } else {
    return blobURL(hash);
    //
    // response = await downloadBlob(hash);
    // if (!response.ok) {
    //   return '';
    // }
    // blob = await response.blob();
    // return '';
  }
  return URL.createObjectURL(blob);
}

function messageKey(id) {
  return `message/${id}`;
}

function blobKey(hash) {
  return `blob/${hash}`;
}

function blobURL(hash) {
  return `/api/blob/${hash}`;
}

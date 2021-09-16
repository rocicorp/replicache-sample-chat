import React, {useEffect, useRef, useState} from 'react';
import {Replicache} from 'replicache';
import {useSubscribe} from 'replicache-react';
import Pusher from 'pusher-js';
import {nanoid} from 'nanoid';

export default function Home() {
  const [rep, setRep] = useState(null);

  useEffect(async () => {
    const rep = new Replicache({
      pushURL: '/api/replicache-push',
      pullURL: '/api/replicache-pull',
      mutators: {
        createMessage: async (tx, {id, from, content, order}) => {
          await tx.put(`message/${id}`, {
            from,
            content,
            order,
          });
        },
      },
    });
    listen(rep);
    setRep(rep);
  }, []);

  return rep && <Chat rep={rep} />;
}

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

  const usernameRef = useRef();
  const contentRef = useRef();

  const onSubmit = async e => {
    e.preventDefault();
    const last = messages.length && messages[messages.length - 1][1];
    const order = (last?.order ?? 0) + 1;
    const from = usernameRef.current.value;
    const content = contentRef.current.value;
    usernameRef.current.value = '';
    contentRef.current.value = '';
    await rep.mutate.createMessage({
      id: nanoid(),
      from,
      content,
      order,
    });
  };

  return (
    <div style={styles.container}>
      <form style={styles.form} onSubmit={onSubmit}>
        <input ref={usernameRef} style={styles.username} required />
        says:
        <input ref={contentRef} style={styles.content} required />
        <input type="submit" />
      </form>
      <MessageList messages={messages} />
    </div>
  );
}

function MessageList({messages}) {
  return messages.map(([k, v]) => {
    return (
      <div key={k}>
        <b>{v.from}: </b>
        {v.content}
      </div>
    );
  });
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
  const pusher = new Pusher(process.env.NEXT_PUBLIC_REPLICHAT_PUSHER_KEY, {
    cluster: process.env.NEXT_PUBLIC_REPLICHAT_PUSHER_CLUSTER,
  });
  const channel = pusher.subscribe('default');
  channel.bind('poke', () => {
    console.log('got poked');
    rep.pull();
  });
}

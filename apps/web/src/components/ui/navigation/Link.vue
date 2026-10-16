<script lang="ts">
import { PropType, h } from 'vue';
import { RouterLink, RouteLocationRaw } from 'vue-router';
import IconArrowOutward from '~icons/material-symbols/arrow-outward-outline-rounded';

export default {
  props: {
    to: {
      type: [Object, String] as PropType<RouteLocationRaw>,
      default: '',
    },
    replace: {
      type: Boolean,
      default: false,
    },
    external: {
      type: Boolean,
      default: false,
    },
    target: {
      type: String as PropType<string | undefined>,
      default: undefined,
    },
    unstyled: {
      type: Boolean,
      default: false,
    },
  },
  setup(props, { slots }) {
    return () => {
      const styleProps = !props.unstyled
        ? {
            class:
              'inline-flex items-center gap-0.5 border-b border-divider text-header transition-colors hover:border-header',
          }
        : {};

      // A text underline skips the icon, so the border draws it under both.
      const content = () =>
        props.unstyled
          ? slots.default?.()
          : [slots.default?.(), h(IconArrowOutward, { class: 'size-3.5 shrink-0', 'aria-hidden': 'true' })];

      if (props.external) {
        return h('a', { href: props.to, target: props.target, ...styleProps }, content());
      }

      return h(
        RouterLink,
        {
          to: props.to,
          replace: props.replace,
          ...styleProps,
        },
        content
      );
    };
  },
};
</script>
